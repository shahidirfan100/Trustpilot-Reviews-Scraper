# API Discovery Report — Trustpilot Reviews Scraper

> **Read this first when the actor fails.** It documents the working request flow, the
> 200-review limit, and the exact query rules that must be preserved.

## Executive Summary

Trustpilot blocks direct HTTP access with **AWS WAF (CloudFront)** and a JavaScript
challenge. A plain request (or an `impit`/`gotScraping` request **without** a WAF token)
returns `403` with a "Verifying Connection" page.

The actor uses a **hybrid flow** that is fast and auto-healing:

1. **Playwright Firefox** loads the review page once to solve the AWS WAF challenge and
   sets the `aws-waf-token` cookie.
2. That cookie (and only that cookie) is handed to an **`impit` HTTP client** (Chrome TLS
   profile) which fetches every review page at HTTP speed. No browser rendering is needed
   for the pages after the token is captured.

**Verified:** `impit` fetches return `200` with `#__NEXT_DATA__` and real reviews when the
`aws-waf-token` cookie is supplied, and `403` without it. Both the `chrome` and `firefox`
impit profiles work once the token is present (tested 2026-10-15).

## The 200-review limit (root cause of "cannot go past 200 reviews")

Trustpilot serves **at most 10 anonymous pages (≈200 reviews) per filter combination**.
Requesting page 11+ returns a `200` whose `__NEXT_DATA__` has `"page": "/users/connect"`
with `props.pageProps.redirectUrl` and no `filters` — i.e. a login/signup wall.

The limit is **per filter combination, not per business**. A different `stars`,
`languages`, `verified`, `replies`, or `sort` value gets a fresh 10-page budget. The actor
**slices filters** (star tiers, language pools, sort order, verified) and deduplicates by
`review_id` to collect far more than 200 reviews.

Example (apify.com, 801 reviews total): unfiltered recency yields 200, then star/language
slices push the run to 300, 500, 1000+ depending on `results_wanted`.

## Blocking Analysis

| Protection Layer | Detail |
|---|---|
| CDN | CloudFront |
| WAF | AWS WAF with JS challenge (`*.edge.sdk.awswaf.com`) |
| Challenge | JS cookie challenge (`aws-waf-token`) + optional reCAPTCHA |
| Detection | Headless browser detection, TLS fingerprinting, header analysis |

## Working Data Source

**URL:** `https://www.trustpilot.com/review/{domain}?<filters>` (HTML page)
**Payload:** `document.querySelector('#__NEXT_DATA__').textContent` → `JSON.props.pageProps`

### Query rules (verified — do not break)

| Rule | Why |
|---|---|
| **Page 1 must OMIT the `page` param** (`?sort=recency&languages=all`) | `?page=1` triggers a redirect that silently drops `stars` and resets `languages` to `en` |
| **Always send `languages`** (default to `languages=all`) | Omitting it defaults to English-only (`sel.languages = "en"`) |
| `stars=N` only on the canonical page-1 URL | Combining `stars` with `page=1` drops the star filter |
| Pages 2–10 use `?page=N` and keep filters | Verified `stars=[5]` persists on page 2+ |
| Stop a slice when page 11 (`/users/connect`) or empty `filters` appears | Anonymous cap per filter |
| Stop a slice when a page returns `< 20` reviews | Last page of that slice |

### Fields available (`props.pageProps`)

- `businessUnit.displayName`, `trustScore`, `numberOfReviews.total`, `websiteUrl`, `isClaimed`
- `reviews[]` → `id`, `title`, `text`, `rating`, `language`, `source`, `labels.verification.*`,
  `isPending`, `filtered`, `likes`, `dates.publishedDate`, `dates.experiencedDate`,
  `consumer.*`, `consumersReviewCountOnSameDomain`, `reply.*`
- `filters.pagination` → `currentPage`, `perPage`, `totalCount`, `totalPages`
- `filters.reviewStatistics.reviewLanguages[]` → `{ isoCode, reviewCount }` (used to plan language slices)
- `filters.selected` → which filters were actually applied (use to confirm slicing worked)

### Pagination / stopping

- `filters.pagination.totalPages` is the site's total, but anonymous access still stops at page 10.
- Slice loop: page 1 (no `page` param) → pages 2..`maxPages` → stop on empty/`/users/connect`/short page.

## Endpoints Tested

| Endpoint | Result |
|---|---|
| `GET /review/{domain}` (HTML) | ✅ Works with `aws-waf-token` (impit) or Playwright Firefox |
| `GET /_next/data/{buildId}/review/{domain}.json` | ✅ Works with token, but returns empty `pageProps` when `Accept: application/json` is set; finicky → not used |
| `GET /api/v1/business-units/...` | ❌ 403 AWS WAF |
| `widget.trustpilot.com` | ❌ 403 AWS WAF |
| `mobile-api` / `consumer-api` / `api.trustpilot.com` | ❌ no usable public review endpoint |

## Client Profile Test Matrix (2026-10-15)

| Client / profile | Token? | Result |
|---|---|---|
| impit `chrome` + WAF token | yes | ✅ `200`, 20 reviews |
| impit `firefox` + WAF token | yes | ✅ `200`, 20 reviews |
| impit (any) without token | no | ❌ `403` |
| Playwright Firefox (`domcontentloaded`, wait `#__NEXT_DATA__`) | solves WAF | ✅ `200` + full payload |
| Same browser context across pages | reuses token | ✅ pagination stays authorized |

**Chosen fast path:** Playwright Firefox for the token, impit `chrome` for data.
**Chosen fallback:** if impit fails (`403`/`429`/`5xx`/challenge), re-solve the token; if it
still fails, fetch the page through the Playwright browser. This is the auto-healing path.

## Auto-Healing Behavior

| Failure | Detection | Recovery |
|---|---|---|
| Token expired / WAF block | `403`, or `200` without `#__NEXT_DATA__` | Re-solve challenge via browser, retry (bounded: 3 tries, 6 session refreshes) |
| Empty page / cap | `pageProps` missing `filters`, or `page === '/users/connect'` | End current slice; move to next filter slice |
| Structural change | Missing expected keys | `classifyPage` logs and treats page as empty instead of crashing |
| impit unusable | Repeated impit failure | Browser fallback fetches the page directly |

Dynamic browser values (cookies), changing headers, and shifting request patterns are all
handled at runtime — nothing about the token, headers, or build id is hardcoded.

## Candidate Rejection Matrix

| Candidate | Decision |
|---|---|
| Trustpilot Business API (`/api/v1/`) | Rejected — 403 AWS WAF |
| Next.js `_next/data` JSON | Rejected — empty `pageProps` under `Accept: application/json`; HTML is more reliable |
| Widget / mobile / consumer APIs | Rejected — blocked or no public review endpoint |
| impit without a WAF token | Rejected — cannot solve the JS challenge |
| Playwright alone | Works but slow; kept only for the token + fallback |
| **Playwright token + impit fetch** | **Selected** — fast, verified, auto-healing |

## Implementation Notes

- impit platform binaries are declared as **optionalDependencies**; the Dockerfile must
  **not** use `--omit=optional` and must verify `import('impit')` at build time.
- **Cloud build requires npm 11.** The base image ships npm 10.9.8, whose resolver crashes
  with `npm error Cannot read properties of null (reading 'edgesOut')` while resolving
  impit's platform optionalDependencies. The Dockerfile installs with
  `npx --yes npm@11.6.2 install ...`; do not switch it back to the bundled npm.
- Do **not** ship a `package-lock.json` generated on the developer machine (npm 11 / Node 24)
  into the Linux image; it is excluded in `.dockerignore` and the image resolves fresh.
- The WAF token is IP-bound, so the browser and impit must share the **same sticky proxy
  session** (`buildProxySessionId`).
- No proxies / headers / tokens are hardcoded in `main.js`.

## Verification Results

- Smoke run (apify.com, `results_wanted=20`): 20 records, 1 request.
- Deep run (apify.com, `results_wanted=300`, deep coverage): **300 records**, 48 requests,
  300 unique `review_id`s, 0 duplicates, 0 empty records — i.e. well past the 200 cap.
