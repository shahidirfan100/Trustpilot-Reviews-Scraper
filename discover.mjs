/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { gotScraping } from 'got-scraping';

const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_OKHTTP = 'okhttp/4.12.0';
const UA_IPHONE_APP = 'Trustpilot/11.6.0 (iPhone; iOS 18.5; Scale/3.00)';

const profiles = [
  {
    name: 'ios-safari-page',
    http2: false,
    headers: {
      'user-agent': UA_IOS,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-user': '?1',
      'sec-fetch-dest': 'document',
    },
  },
  {
    name: 'ios-safari-api',
    http2: false,
    headers: {
      'user-agent': UA_IOS,
      accept: 'application/json',
      'accept-language': 'en-US,en;q=0.9',
      'x-requested-with': 'XMLHttpRequest',
      referer: 'https://www.trustpilot.com/',
    },
  },
  {
    name: 'android-app-api',
    http2: false,
    headers: {
      'user-agent': UA_OKHTTP,
      accept: 'application/json',
      'accept-language': 'en-US',
      'x-requested-with': 'com.trustpilot.trustpilot',
    },
  },
  {
    name: 'iphone-app-api',
    http2: false,
    headers: {
      'user-agent': UA_IPHONE_APP,
      accept: 'application/json',
      'accept-language': 'en-US',
      'x-requested-with': 'com.trustpilot.iphoneapp',
    },
  },
  {
    name: 'desktop-chrome-page',
    http2: false,
    headers: {
      'user-agent': UA_DESKTOP,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Google Chrome";v="124", "Chromium";v="124"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-user': '?1',
      'sec-fetch-dest': 'document',
    },
  },
  {
    name: 'android-chrome-page',
    http2: false,
    headers: {
      'user-agent': UA_ANDROID,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Google Chrome";v="124", "Chromium";v="124"',
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-platform': '"Android"',
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-user': '?1',
      'sec-fetch-dest': 'document',
    },
  },
];

const endpoints = [
  { label: 'review-page', url: 'https://www.trustpilot.com/review/apify.com' },
  { label: 'business-units', url: 'https://www.trustpilot.com/api/v1/business-units/apify.com' },
  { label: 'reviews', url: 'https://www.trustpilot.com/api/v1/business-units/apify.com/reviews?page=1&perPage=20&sort=recency' },
  { label: 'next-data-latest', url: 'https://www.trustpilot.com/_next/data/latest/review/apify.com.json?page=1' },
  { label: 'mobile-api-v2', url: 'https://mobile-api.trustpilot.com/v1/business-units/apify.com' },
  { label: 'consumer-api-v2', url: 'https://consumer-api.trustpilot.com/v1/business-units/apify.com' },
  { label: 'api-v2', url: 'https://api.trustpilot.com/v1/business-units/apify.com' },
  { label: 'graphql', url: 'https://www.trustpilot.com/graphql' },
];

async function tryProfile(profile, label, url) {
  try {
    const r = await gotScraping.get(url, {
      ...profile,
      throwHttpErrors: false,
      useHeaderGenerator: false,
      timeout: { request: 30000 },
    });
    const ct = r.headers['content-type'] || '';
    const isJson = ct.includes('json');
    let marker = '';
    if (isJson) {
      try {
        const d = JSON.parse(r.body);
        marker = `keys=${  Object.keys(d).slice(0, 10).join(',')  } len=${  r.body.length}`;
      } catch {
        marker = `JSONPARSEFAIL len=${  r.body.length}`;
      }
    } else {
      const blocked = /verify|access denied|captcha|robot|challenge/i.test(r.body) ? 'BLOCKED' : 'OK';
      marker = `len=${r.body.length} ${blocked}`;
    }
    console.log(`[${profile.name}/${label}] ${r.statusCode} ct=${ct} | ${marker}`);
    return { profile: profile.name, label, status: r.statusCode, isJson, body: r.body };
  } catch (e) {
    console.log(`[${profile.name}/${label}] ERR ${e.message}`);
    return { profile: profile.name, label, err: e.message };
  }
}

async function run() {
  for (const endpoint of endpoints) {
    for (const profile of profiles) {
      await tryProfile(profile, endpoint.label, endpoint.url);
    }
  }
}

await run();
