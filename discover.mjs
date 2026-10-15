/* eslint-disable no-console */

// Verification harness for the hybrid Trustpilot flow.
//
// Run: node discover.mjs [domain]
//
// It proves that the browser-solved `aws-waf-token` authorizes impit requests for
// both supported impit profiles (chrome and firefox), and that a request without
// the token is blocked. See API_DISCOVERY.md for the full flow.

import { Impit } from 'impit';
import { firefox } from 'playwright';

const DOMAIN = process.argv[2] || 'apify.com';
const BASE_URL = 'https://www.trustpilot.com';
const NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

function pageUrl(domain, query = {}) {
    const url = new URL(`${BASE_URL}/review/${domain}`);
    if (query.page && query.page > 1) url.searchParams.set('page', String(query.page));
    url.searchParams.set('languages', query.languages || 'all');
    if (query.sort) url.searchParams.set('sort', query.sort);
    if (query.stars) url.searchParams.set('stars', String(query.stars));
    return url.href;
}

async function solveWafToken(domain) {
    const browser = await firefox.launch({ headless: true });
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    await page.goto(pageUrl(domain, { sort: 'recency' }), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: 60000 });
    const cookies = await context.cookies();
    await browser.close();
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function reviewCount(html) {
    const match = html.match(NEXT_DATA_RE);
    if (!match) return null;
    try {
        const payload = JSON.parse(match[1]);
        const reviews = payload?.props?.pageProps?.reviews;
        return Array.isArray(reviews) ? reviews.length : null;
    } catch {
        return null;
    }
}

async function probe(profile, url, cookie) {
    const client = new Impit({ browser: profile });
    const headers = cookie ? { Cookie: cookie, Accept: 'text/html,application/xhtml+xml' } : { Accept: 'text/html' };
    try {
        const response = await client.fetch(url, { headers, redirect: 'follow' });
        const html = await response.text();
        const count = reviewCount(html);
        const verdict = count === null ? 'BLOCKED (no __NEXT_DATA__)' : `OK reviews=${count}`;
        console.log(`[${profile}] ${response.status} ${verdict}`);
        return count !== null;
    } catch (error) {
        console.log(`[${profile}] ERROR ${error.message}`);
        return false;
    }
}

async function main() {
    console.log(`Domain: ${DOMAIN}`);
    const cookie = await solveWafToken(DOMAIN);
    console.log(`Token cookie: ${cookie.split('=')[0]}`);

    const page2 = pageUrl(DOMAIN, { page: 2, sort: 'recency' });
    const stars1 = pageUrl(DOMAIN, { sort: 'recency', stars: 1 });

    console.log('\n-- control: no token (expected 403) --');
    await probe('chrome', page2, '');

    console.log('\n-- with token --');
    const results = [];
    for (const profile of ['chrome', 'firefox']) {
        results.push([profile, 'page2', await probe(profile, page2, cookie)]);
        results.push([profile, 'stars=1', await probe(profile, stars1, cookie)]);
    }

    const working = results.filter(([, , ok]) => ok).map(([profile]) => profile);
    console.log(
        `\nResult: ${working.length ? `working profiles -> ${[...new Set(working)].join(', ')}` : 'no working profile'}`,
    );
}

await main();
