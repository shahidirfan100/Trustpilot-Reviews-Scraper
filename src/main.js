import { Actor, log } from 'apify';
import { Impit } from 'impit';
import { firefox } from 'playwright';

const BASE_URL = 'https://www.trustpilot.com';
const REVIEWS_PER_PAGE = 20;
// Trustpilot only serves ~10 anonymous pages (200 reviews) per filter combination,
// then redirects to /users/connect. Deep coverage slices filters to go past it.
const ANON_PAGE_CAP = 10;
const PAGE_NAVIGATION_TIMEOUT_MS = 45000;
const NEXT_DATA_TIMEOUT_MS = 20000;
const REQUEST_RETRY_LIMIT = 3;
const MAX_SESSION_REFRESHES = 6;
const NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

await Actor.init();

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

function parsePositiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseStarFilter(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
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

function normalizeLanguage(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : 'all';
}

function normalizeBusinessDomain(value) {
    const source = value && typeof value === 'object' ? value.url : value;
    const raw = String(source ?? '').trim();
    if (!raw) return '';
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
    try {
        const url = new URL(withProtocol);
        if (/trustpilot\.com$/i.test(url.hostname)) {
            const segments = url.pathname.split('/').filter(Boolean);
            const reviewIndex = segments.indexOf('review');
            if (reviewIndex !== -1 && segments[reviewIndex + 1]) return segments[reviewIndex + 1];
            return segments[segments.length - 1] || '';
        }
        return url.hostname;
    } catch {
        return raw.split('/')[0];
    }
}

function wantsProxy(proxyConfiguration) {
    if (!proxyConfiguration || typeof proxyConfiguration !== 'object') return false;
    if (Array.isArray(proxyConfiguration.proxyUrls) && proxyConfiguration.proxyUrls.length > 0) return true;
    return Boolean(proxyConfiguration.useApifyProxy);
}

function buildProxySessionId(domain) {
    // Apify proxy session IDs must be alphanumeric and short. The same sticky
    // session is shared by the browser and impit because the WAF token is IP-bound.
    const safe = domain.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
    return `tp${Date.now().toString(36)}${safe}`.slice(0, 49);
}

// ---------------------------------------------------------------------------
// URL building + parsing
// ---------------------------------------------------------------------------

function buildReviewUrl(domain, query) {
    const url = new URL(`${BASE_URL}/review/${domain}`);
    // Page 1 must omit the `page` param: including it triggers a redirect that
    // silently drops the active filters and language selection.
    if (query.page && query.page > 1) url.searchParams.set('page', String(query.page));
    if (query.sort) url.searchParams.set('sort', query.sort);
    url.searchParams.set('languages', query.languages || 'all');
    if (query.stars) url.searchParams.set('stars', String(query.stars));
    if (query.verified) url.searchParams.set('verified', 'true');
    if (query.replies) url.searchParams.set('replies', 'true');
    return url.href;
}

function parseNextDataHtml(html) {
    const match = html.match(NEXT_DATA_RE);
    if (!match) return null;
    try {
        return JSON.parse(match[1]);
    } catch {
        return null;
    }
}

function classifyPage(raw) {
    const pageProps = raw?.props?.pageProps ?? null;
    const login = raw?.page === '/users/connect' || Boolean(pageProps?.redirectUrl);
    if (login || !pageProps?.filters) {
        return { props: pageProps, empty: true, login, reviews: [] };
    }
    return { props: pageProps, empty: false, login: false, reviews: pageProps.reviews ?? [] };
}

function mapReview(review, businessUnit, pageInfo) {
    const consumer = review.consumer || {};
    const dates = review.dates || {};
    const reply = review.reply || null;
    const verification = review.labels?.verification || {};
    const bu = businessUnit || {};

    const record = {
        review_id: review.id || undefined,
        review_url: `${BASE_URL}/review/${pageInfo.businessDomain}?page=${pageInfo.page}`,
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

// ---------------------------------------------------------------------------
// Filter slicing: each unique filter combination gets a fresh 10-page budget
// ---------------------------------------------------------------------------

function planSlices(options, pageProps) {
    const slices = [];
    const keys = new Set();
    const baseSort = options.sort || 'recency';
    const baseLanguages = options.languages || 'all';

    const add = (slice) => {
        const key = [
            slice.sort,
            slice.languages,
            slice.stars ?? 'any',
            slice.verified ? 1 : 0,
            slice.replies ? 1 : 0,
        ].join('|');
        if (keys.has(key)) return;
        keys.add(key);
        slices.push(slice);
    };

    const base = {
        sort: baseSort,
        languages: baseLanguages,
        stars: options.stars,
        verified: Boolean(options.verified),
        replies: false,
    };
    add(base);

    // Star tiers are only safe when the caller did not restrict stars.
    if (options.stars == null) {
        for (const stars of [5, 4, 3, 2, 1]) {
            add({
                sort: 'recency',
                languages: baseLanguages,
                stars,
                verified: Boolean(options.verified),
                replies: false,
            });
        }
    }

    // Language pools are only safe when the caller asked for all languages.
    if (baseLanguages === 'all') {
        const languageStats = pageProps?.filters?.reviewStatistics?.reviewLanguages || [];
        for (const language of languageStats) {
            if (!language?.isoCode || language.isoCode === 'all' || !language.reviewCount) continue;
            add({
                sort: baseSort,
                languages: language.isoCode,
                stars: options.stars,
                verified: Boolean(options.verified),
                replies: false,
            });
        }
    }

    // Sort is part of the filter combination, so a different order exposes more reviews.
    add({ ...base, sort: baseSort === 'recency' ? 'relevance' : 'recency' });
    // Verified-only is a subset of the requested universe.
    if (!options.verified) add({ ...base, verified: true });

    return slices;
}

function describeSlice(slice) {
    const parts = [`sort=${slice.sort}`, `lang=${slice.languages}`];
    if (slice.stars) parts.push(`stars=${slice.stars}`);
    if (slice.verified) parts.push('verified');
    if (slice.replies) parts.push('replies');
    return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Session handling: browser solves AWS WAF once, impit fetches at HTTP speed
// ---------------------------------------------------------------------------

function buildRequestHeaders(session) {
    return {
        Cookie: session.cookieHeader,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: `${BASE_URL}/review/${session.domain}`,
    };
}

function cookieHeaderFrom(cookies) {
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

async function acquireSession(page, domain, baseQuery) {
    const url = buildReviewUrl(domain, { ...baseQuery, page: 1 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_NAVIGATION_TIMEOUT_MS });
    await page.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: NEXT_DATA_TIMEOUT_MS });
    const cookies = await page.context().cookies();
    const raw = await page.evaluate(() => {
        const el = document.querySelector('#__NEXT_DATA__');
        return el ? el.textContent : null;
    });
    let rawPage = null;
    let pageProps = null;
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            rawPage = parsed?.page ?? null;
            pageProps = parsed?.props?.pageProps ?? null;
        } catch {
            pageProps = null;
        }
    }
    return { cookieHeader: cookieHeaderFrom(cookies), pageProps, rawPage };
}

function createSession({ domain, page, client, cookieHeader, baseQuery }) {
    return {
        domain,
        page,
        client,
        cookieHeader,
        baseQuery,
        refreshes: 0,
        applyCookies(header) {
            if (header) this.cookieHeader = header;
        },
        beginRefresh() {
            this.refreshes += 1;
            return this.refreshes;
        },
    };
}

async function refreshSession(session) {
    if (session.refreshes >= MAX_SESSION_REFRESHES) return false;
    const count = session.beginRefresh();
    log.warning(`Refreshing Trustpilot session for ${session.domain} (${count}/${MAX_SESSION_REFRESHES})`);
    try {
        const fresh = await acquireSession(session.page, session.domain, session.baseQuery);
        session.applyCookies(fresh.cookieHeader);
        return true;
    } catch (error) {
        log.warning(`Session refresh failed: ${error.message}`);
        return false;
    }
}

async function fetchPropsViaBrowser(session, url) {
    try {
        await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_NAVIGATION_TIMEOUT_MS });
        await session.page.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: NEXT_DATA_TIMEOUT_MS });
        const cookies = await session.page.context().cookies();
        if (cookies.length) session.applyCookies(cookieHeaderFrom(cookies));
        const raw = await session.page.evaluate(() => {
            const el = document.querySelector('#__NEXT_DATA__');
            return el ? el.textContent : null;
        });
        if (!raw) return { props: null, empty: true, login: false, reviews: [] };
        return classifyPage(JSON.parse(raw));
    } catch (error) {
        log.warning(`Browser fallback failed: ${error.message}`);
        return { props: null, empty: true, login: false, reviews: [] };
    }
}

async function fetchProps(session, query) {
    const url = buildReviewUrl(session.domain, query);
    let lastError = null;

    for (let attempt = 1; attempt <= REQUEST_RETRY_LIMIT; attempt++) {
        try {
            const response = await session.client.fetch(url, {
                headers: buildRequestHeaders(session),
                redirect: 'follow',
            });
            if (!response.ok) {
                lastError = `HTTP ${response.status}`;
                const recoverable = response.status === 403 || response.status === 429 || response.status >= 500;
                if (recoverable && (await refreshSession(session))) continue;
                break;
            }
            const html = await response.text();
            const raw = parseNextDataHtml(html);
            if (!raw) {
                lastError = 'challenge page without __NEXT_DATA__';
                if (await refreshSession(session)) continue;
                break;
            }
            return classifyPage(raw);
        } catch (error) {
            lastError = error.message;
            if (!(await refreshSession(session))) break;
        }
    }

    log.warning(`impit failed for ${describeSlice(query)} page ${query.page} (${lastError}); using browser fallback`);
    return fetchPropsViaBrowser(session, url);
}

async function createContext(browser, proxyUrl) {
    return browser.newContext({
        locale: 'en-US',
        ...(proxyUrl ? { proxy: parseProxyUrl(proxyUrl) } : {}),
    });
}

async function blockHeavyResources(page) {
    await page.route('**/*', (route) => {
        const request = route.request();
        const resourceType = request.resourceType();
        const url = request.url();
        if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) return route.abort();
        if (/google-analytics|googletagmanager|facebook|doubleclick|adsense|hotjar|sentry|newrelic/i.test(url))
            return route.abort();
        return route.continue();
    });
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

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function run() {
    const input = (await Actor.getInput()) || {};
    const resultsWanted = parsePositiveInteger(input.results_wanted ?? input.maxReviews, 20);
    const maxPagesPerSlice = Math.min(parsePositiveInteger(input.max_pages, ANON_PAGE_CAP), ANON_PAGE_CAP);

    const requestedDomains = toArray(input.urls).map(normalizeBusinessDomain).filter(Boolean);
    const domains = requestedDomains.length ? [...new Set(requestedDomains)] : ['apify.com'];

    const options = {
        sort: input.sort || 'recency',
        languages: normalizeLanguage(input.languages),
        stars: parseStarFilter(input.stars ?? input.rating),
        verified: Boolean(input.verified),
    };

    const proxyInput = input.proxyConfiguration;
    let proxyConfiguration = null;
    if (wantsProxy(proxyInput)) {
        proxyConfiguration = await Actor.createProxyConfiguration(proxyInput);
    } else if (proxyInput === undefined && Actor.isAtHome()) {
        proxyConfiguration = await Actor.createProxyConfiguration({
            useApifyProxy: true,
            apifyProxyGroups: ['RESIDENTIAL'],
            countryCode: 'US',
        });
    }

    const seenReviewIds = new Set();
    let totalSaved = 0;
    let totalRequests = 0;
    let loadFailures = 0;
    let stopReason = 'completed';
    let browser = null;

    try {
        browser = await firefox.launch({ headless: true });

        for (const domain of domains) {
            if (totalSaved >= resultsWanted) break;

            const proxyUrl = proxyConfiguration
                ? await proxyConfiguration.newUrl(buildProxySessionId(domain))
                : undefined;
            const context = await createContext(browser, proxyUrl);
            const page = await context.newPage();
            await blockHeavyResources(page);

            try {
                const baseQuery = {
                    sort: options.sort,
                    languages: options.languages,
                    stars: options.stars,
                    verified: options.verified,
                };

                let acquired;
                try {
                    acquired = await acquireSession(page, domain, baseQuery);
                } catch (error) {
                    loadFailures += 1;
                    log.error(`Could not load Trustpilot reviews for ${domain}: ${error.message}`);
                    continue;
                }

                const session = createSession({
                    domain,
                    page,
                    client: new Impit({ browser: 'chrome', ...(proxyUrl ? { proxyUrl } : {}) }),
                    cookieHeader: acquired.cookieHeader,
                    baseQuery,
                });

                const slices = planSlices(options, acquired.pageProps);
                log.info(`Scraping ${domain} | target=${resultsWanted} reviews`);

                for (const slice of slices) {
                    if (totalSaved >= resultsWanted) break;

                    let sliceSaved = 0;
                    for (let pageNum = 1; pageNum <= maxPagesPerSlice; pageNum++) {
                        if (totalSaved >= resultsWanted) break;

                        const query = { ...slice, page: pageNum };
                        const result = await fetchProps(session, query);
                        totalRequests += 1;

                        if (!result || result.empty) {
                            if (pageNum === 1) {
                                const reason = result?.login ? 'login wall' : 'no reviews';
                                log.debug(`Slice ${describeSlice(slice)}: ${reason}`);
                            }
                            break;
                        }

                        const reviews = result.reviews || [];
                        const batch = [];
                        for (const review of reviews) {
                            if (!review?.id || seenReviewIds.has(review.id)) continue;
                            if (totalSaved + batch.length >= resultsWanted) break;
                            seenReviewIds.add(review.id);
                            batch.push(
                                mapReview(review, result.props?.businessUnit, {
                                    url: buildReviewUrl(domain, query),
                                    page: pageNum,
                                    businessDomain: domain,
                                }),
                            );
                        }

                        if (batch.length) {
                            await Actor.pushData(batch);
                            totalSaved += batch.length;
                            sliceSaved += batch.length;
                        }

                        if (reviews.length < REVIEWS_PER_PAGE) break;
                    }

                    if (sliceSaved > 0) {
                        log.info(
                            `${describeSlice(slice)}: +${sliceSaved} reviews (total ${totalSaved}/${resultsWanted})`,
                        );
                    }
                }
            } finally {
                await context.close().catch(() => {});
            }
        }

        if (totalSaved >= resultsWanted) stopReason = 'results_limit';
    } finally {
        if (browser) await browser.close().catch(() => {});
    }

    if (totalSaved === 0 && loadFailures === domains.length) {
        throw new Error('Could not load any Trustpilot review page. Check the URLs and proxy configuration.');
    }

    log.info(`Done | saved=${totalSaved} | requests=${totalRequests} | stop_reason=${stopReason}`);
}

try {
    await run();
    await Actor.exit();
} catch (error) {
    log.error(`Run failed: ${error.message}`);
    process.exitCode = 1;
    await Actor.exit({ exitCode: 1 });
}
