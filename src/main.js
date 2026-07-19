import { Actor, log } from 'apify';
import { existsSync, readFileSync } from 'fs';
import { firefox } from 'playwright';

const MAX_PAGES = 50;
const PAGE_TIMEOUT_SEC = 120;

await Actor.init();

function parsePositiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function toArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function normalizeString(value) {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') return value.trim() || undefined;
    return value;
}

function readLocalInputFile() {
    const path = 'INPUT.json';
    if (existsSync(path)) {
        try {
            const content = readFileSync(path, 'utf-8');
            return JSON.parse(content);
        } catch {
            return {};
        }
    }
    return {};
}

function getReviewPageUrl(baseUrl, page, options) {
    const url = new URL(baseUrl);
    url.searchParams.set('page', String(page));
    if (options.sort) url.searchParams.set('sort', options.sort);
    if (options.languages && options.languages !== 'all') url.searchParams.set('languages', options.languages);
    if (options.stars) url.searchParams.set('stars', String(options.stars));
    if (options.verified) url.searchParams.set('verified', 'true');
    return url.href;
}

function extractBusinessDomain(reviewPageUrl) {
    const pathParts = new URL(reviewPageUrl).pathname.split('/').filter(Boolean);
    return pathParts[pathParts.length - 1];
}

function parseNextDataPayload(page) {
    return page.evaluate(() => {
        const el = document.querySelector('#__NEXT_DATA__');
        if (!el || !el.textContent) return null;
        try { return JSON.parse(el.textContent); } catch { return null; }
    });
}

function mapReview(review, businessUnit, pageInfo) {
    const consumer = review.consumer || {};
    const dates = review.dates || {};
    const reply = review.reply || null;
    const verification = review.labels?.verification || {};
    const bu = businessUnit || {};

    const record = {
        review_id: review.id || undefined,
        review_url: `https://www.trustpilot.com/review/${pageInfo.businessDomain}?page=${pageInfo.page}`,
        source_url: pageInfo.url,
        source_page: pageInfo.page,
        business_domain: pageInfo.businessDomain,
        business_name: bu.displayName || undefined,
        business_trust_score: bu.trustScore ?? undefined,
        business_review_count: bu.numberOfReviews?.total ?? undefined,
        business_website: bu.websiteUrl || undefined,
        business_is_claimed: bu.isClaimed ?? undefined,
        title: normalizeString(review.title),
        text: normalizeString(review.text),
        rating: review.rating ?? undefined,
        language: review.language || undefined,
        review_source: review.source || undefined,
        is_verified: verification.isVerified ?? null,
        verification_source: verification.verificationSource || undefined,
        verification_level: verification.verificationLevel || undefined,
        is_pending: review.isPending ?? undefined,
        is_filtered: review.filtered ?? undefined,
        likes_count: review.likes ?? undefined,
        published_date: dates.publishedDate || undefined,
        experience_date: dates.experiencedDate || undefined,
        reviewer_id: consumer.id || undefined,
        reviewer_name: consumer.displayName || undefined,
        reviewer_country: consumer.countryCode || undefined,
        reviewer_review_count: consumer.numberOfReviews ?? undefined,
        reviewer_is_verified: consumer.isVerified ?? undefined,
        consumers_review_count_on_same_domain: review.consumersReviewCountOnSameDomain ?? undefined,
    };

    if (reply && reply.message) {
        record.company_reply_text = normalizeString(reply.message);
        record.company_reply_date = reply.createdAt || reply.publishedDate || undefined;
        record.company_reply_respondent_name = reply.respondent?.displayName || undefined;
    }

    for (const [key, value] of Object.entries(record)) {
        if (value === undefined) delete record[key];
    }

    return record;
}

function shouldStopCrawling(pageProps, page, maxPages) {
    if (page >= maxPages) return true;
    const pagination = pageProps?.filters?.pagination;
    if (!pagination) return false;
    if (page >= pagination.totalPages) return true;
    return false;
}

function parseInput(raw) {
    if (!raw) return {};
    if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return {}; }
    }
    return raw;
}

async function run() {
    const input = { ...parseInput(readLocalInputFile()), ...parseInput(await Actor.getInput()) };
    const resultsWanted = parsePositiveInteger(input.results_wanted ?? input.maxReviews, 20);
    const maxPages = Math.min(parsePositiveInteger(input.max_pages, 10), MAX_PAGES);
    const urls = toArray(input.urls);
    const startUrls = urls.length ? [...new Set(urls)] : ['https://www.trustpilot.com/review/apify.com'];
    const options = {
        sort: input.sort || 'recency',
        languages: input.languages || 'all',
        stars: input.stars || input.rating,
        verified: Boolean(input.verified),
    };

    const proxyConfig = input.proxyConfiguration;
    const effectiveProxy = proxyConfig ?? (Actor.isAtHome()
        ? { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], countryCode: 'US' }
        : null);
    const proxyConf = effectiveProxy
        ? await Actor.createProxyConfiguration({ ...effectiveProxy })
        : null;

    const seenReviewIds = new Set();
    let totalSaved = 0;
    let totalPagesProcessed = 0;
    let browser = null;

    try {
        browser = await firefox.launch({ headless: true });

        const pageStartTime = Date.now();
        for (const startUrl of startUrls) {
            const businessDomain = extractBusinessDomain(startUrl);

            for (let pageNum = 1; pageNum <= maxPages && totalSaved < resultsWanted; pageNum++) {
                const elapsedSec = (Date.now() - pageStartTime) / 1000;
                if (elapsedSec > PAGE_TIMEOUT_SEC && totalSaved > 0) {
                    log.info(`Reached ${PAGE_TIMEOUT_SEC}s limit. Stopping.`);
                    break;
                }

                const reviewPageUrl = getReviewPageUrl(startUrl, pageNum, options);
                log.info(`Fetching page ${pageNum}`);

                const maxRetries = 6;
                let pageData = null;
                let businessUnit = {};

                for (let retry = 0; retry < maxRetries && !pageData; retry++) {
                    let ctx = null;
                    try {
                        const sessionId = `tp-${Date.now()}-${pageNum}-${retry}`;
                        const proxyUrl = proxyConf ? await proxyConf.newUrl(sessionId) : undefined;
                        ctx = await browser.newContext({
                            locale: 'en-US',
                            ...(proxyUrl ? { proxy: await parseProxyUrl(proxyUrl) } : {}),
                        });
                        const p = await ctx.newPage();
                        await p.route('**/*', (r) => {
                            const url = r.request().url();
                            if (/google-analytics|googletagmanager|facebook|doubleclick|adsense|hotjar|sentry|newrelic|doubleclick/i.test(url)) return r.abort();
                            return r.continue();
                        });
                        await p.goto(reviewPageUrl, { waitUntil: 'load', timeout: 60000 });
                        await p.waitForTimeout(3000);
                        await p.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: 45000 }).catch(() => {});
                        const raw = await parseNextDataPayload(p);
                        if (raw?.props?.pageProps?.reviews?.length) {
                            pageData = raw.props.pageProps;
                            businessUnit = pageData.businessUnit || {};
                        }
                    } catch {
                        // continue to next retry
                    } finally {
                        if (ctx) await ctx.close().catch(() => {});
                    }
                }

                totalPagesProcessed++;
                if (!pageData) {
                    log.warning(`Page ${pageNum} failed after ${maxRetries} retries.`);
                    if (pageNum === 1) break;
                    continue;
                }

                const reviews = pageData.reviews || [];
                const batch = [];
                for (const review of reviews) {
                    if (totalSaved + batch.length >= resultsWanted) break;
                    if (seenReviewIds.has(review.id)) continue;
                    seenReviewIds.add(review.id);
                    batch.push(mapReview(review, businessUnit, {
                        url: reviewPageUrl, page: pageNum, businessDomain,
                    }));
                }

                if (batch.length) {
                    await Actor.pushData(batch);
                    totalSaved += batch.length;
                    log.info(`Saved ${batch.length} reviews. Total: ${totalSaved}/${resultsWanted}`);
                }

                if (shouldStopCrawling(pageData, pageNum, maxPages)) break;
                if (reviews.length < 20) break;
            }
        }
    } finally {
        if (browser) await browser.close().catch(() => {});
    }

    log.info(`Done | saved=${totalSaved} | pages=${totalPagesProcessed}`);
}

async function parseProxyUrl(proxyUrl) {
    try {
        if (!proxyUrl) return undefined;
        const parsed = new URL(proxyUrl);
        const server = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
        const result = { server };
        if (parsed.username) result.username = decodeURIComponent(parsed.username);
        if (parsed.password) result.password = decodeURIComponent(parsed.password);
        return result;
    } catch {
        return undefined;
    }
}

try {
    await run();
    await Actor.exit();
} catch (error) {
    log.error(`Run failed: ${error.message}`);
    process.exitCode = 1;
    await Actor.exit({ exitCode: 1 });
}
