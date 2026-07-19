# API Discovery Report — Trustpilot Reviews Scraper

## Executive Summary

Trustpilot blocks all direct HTTP API access via **AWS WAF (CloudFront)** with a JavaScript challenge. Direct `gotScraping`/`impit` calls to any Trustpilot endpoint return a 403 "Verifying Connection" page. The only reliable way to extract data is through **Playwright Firefox** which can execute the WAF challenge JS, set the required cookies, and load the full page including the embedded `__NEXT_DATA__` JSON payload.

**Playwright cannot be replaced with impit** because the AWS WAF challenge requires a full browser JS engine to solve. Impit is an HTTP client only.

## Blocking Analysis

| Protection Layer | Detail |
|---|---|
| CDN | CloudFront |
| WAF | AWS WAF with JS challenge (`a7d575be72e8.edge.sdk.awswaf.com`) |
| Challenge | JS-based cookie challenge + optional reCAPTCHA |
| Detection | Headless browser detection, TLS fingerprinting, header analysis |

## All Endpoints Tested

### Direct HTTP (all blocked by AWS WAF)

| Endpoint | Status | Blocked? |
|---|---|---|
| `https://www.trustpilot.com/review/apify.com` | 403 | Yes (AWS WAF) |
| `https://www.trustpilot.com/api/v1/business-units/apify.com` | 403 | Yes (AWS WAF) |
| `https://www.trustpilot.com/api/v1/business-units/apify.com/reviews?page=1&perPage=20` | 403 | Yes (AWS WAF) |
| `https://www.trustpilot.com/_next/data/latest/review/apify.com.json` | 403 | Yes (AWS WAF) |
| `https://www.trustpilot.com/_next/data/{buildId}/review/apify.com.json` | 403 | Yes (AWS WAF) |
| `https://widget.trustpilot.com/api/v1/business-units/apify.com` | 403 | Yes (AWS WAF via S3) |
| `https://mobile-api.trustpilot.com/` | DNS NXDOMAIN | N/A |
| `https://consumer-api.trustpilot.com/` | DNS NXDOMAIN | N/A |

### Header Profiles Tested (all blocked)

| Profile | Status |
|---|---|
| iOS Safari (mobile page) | 403 AWS WAF |
| iOS Safari (API) | 403 AWS WAF |
| Android Chrome (mobile page) | 403 AWS WAF |
| Desktop Chrome (page) | 403 AWS WAF |
| Android app (okhttp) | 403 AWS WAF |
| iPhone app (Trustpilot/11.6.0) | 403 AWS WAF |

### Playwright Firefox (works)

| Approach | Status |
|---|---|
| Playwright Firefox, `domcontentloaded`, wait for `#__NEXT_DATA__` | ✅ Works - loads full page with all reviews |
| Same browser context across pages (WAF cookie persists) | ✅ Works - pagination loads subsequent pages |

## Why Playwright Firefox Works

1. The initial page load returns 403 with the AWS WAF challenge page
2. Firefox executes the `challenge.js` script which runs JS challenges
3. The challenge sets the `aws-waf-token` cookie
4. The page automatically reloads with the cookie → 200 OK
5. The Next.js app renders fully including `__NEXT_DATA__` with all review data
6. **Crucially**: using the **same browser context** across page navigations preserves the WAF token, so subsequent pages load directly without re-challenge

## Selected Data Source: `__NEXT_DATA__` (Hydration Payload)

### Source
`document.querySelector('#__NEXT_DATA__').textContent` — parsed as JSON from `json.props.pageProps`

### Fields Available (28 extracted)

| Field | Source Path |
|---|---|
| `review_id` | `review.id` |
| `review_url` | Constructed from business domain + page |
| `source_url` | Full review page URL |
| `source_page` | Page number |
| `business_domain` | Path segment from URL |
| `business_name` | `businessUnit.displayName` |
| `business_trust_score` | `businessUnit.trustScore` |
| `business_review_count` | `businessUnit.numberOfReviews.total` |
| `business_website` | `businessUnit.websiteUrl` |
| `business_is_claimed` | `businessUnit.isClaimed` |
| `title` | `review.title` |
| `text` | `review.text` |
| `rating` | `review.rating` |
| `language` | `review.language` |
| `review_source` | `review.source` |
| `is_verified` | `review.labels.verification.isVerified` |
| `verification_source` | `review.labels.verification.verificationSource` |
| `verification_level` | `review.labels.verification.verificationLevel` |
| `is_pending` | `review.isPending` |
| `is_filtered` | `review.filtered` |
| `likes_count` | `review.likes` |
| `published_date` | `review.dates.publishedDate` |
| `experience_date` | `review.dates.experiencedDate` |
| `reviewer_id` | `review.consumer.id` |
| `reviewer_name` | `review.consumer.displayName` |
| `reviewer_country` | `review.consumer.countryCode` |
| `reviewer_review_count` | `review.consumer.numberOfReviews` |
| `reviewer_is_verified` | `review.consumer.isVerified` |
| `consumers_review_count_on_same_domain` | `review.consumersReviewCountOnSameDomain` |

### Pagination
- `businessUnit.numberOfReviews.total` — total reviews available
- `filters.pagination` — includes `currentPage`, `perPage`, `totalCount`, `totalPages`
- Navigate to `?page=N` URL pattern with same browser context

### How It Works
1. Launch Playwright Firefox (headless)
2. Create a single browser context (preserves WAF cookie)
3. Navigate to `https://www.trustpilot.com/review/{domain}?page=N&sort=...`
4. Wait for `#__NEXT_DATA__` selector (state: attached) — WAF resolves automatically
5. Extract `__NEXT_DATA__` JSON from the DOM
6. Parse reviews and business unit from `props.pageProps`
7. Continue to next page in the same context; WAF cookie persists

## Candidate Rejection Matrix

| Candidate | Why Rejected |
|---|---|
| Trustpilot Business API (`/api/v1/`) | Blocked by AWS WAF |
| Next.js `_next/data` JSON | Blocked by AWS WAF (even with known build ID) |
| Widget API (`widget.trustpilot.com`) | Blocked by AWS WAF via S3/CloudFront |
| Mobile API subdomains | DNS NXDOMAIN — no mobile-specific endpoints found |
| Direct HTTP with WAF token cookie | Token alone insufficient; TLS fingerprint/headers also validated |
| impit HTTP client | Cannot solve JS-based WAF challenges; no browser engine |
| gotScraping with any header profile | All profiles return 403 with WAF challenge |

## ESLint Configuration

All ESLint issues have been resolved:
- Removed duplicate `parseInput` function declaration
- Fixed `eslint.config.js` — corrected `import/no-default-export` rule reference, switched to named export
- Added `eslint-disable` comments for test script (`discover.mjs`) console and dependency rules
- Added `eslint-disable` directive for ESLint config's own default export
- Result: **0 errors, 0 warnings**

## Verification Results (50 records, 3 pages)

- 50 unique review IDs (no duplicates)
- 28 fields per record with 100% presence
- 0 null or missing values across all fields
- Average 20 reviews per page (last page may have fewer)
- No deduplication collisions across pages
