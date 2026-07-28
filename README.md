## What does Trustpilot Reviews Scraper do?

Trustpilot Reviews Scraper collects public reviews, ratings, reviewer profiles, and company metadata from Trustpilot company pages. Add one or more Trustpilot review URLs or plain company domains, and the actor returns structured datasets with review text, star ratings, published dates, verification signals, business TrustScore, and company replies. It is designed for reputation monitoring, competitor research, customer feedback analysis, and data enrichment workflows that need Trustpilot data without manual copy-paste.

Trustpilot does not provide a public API for review extraction at scale. This actor works with the public Trustpilot website to help you collect the data you need.

## Why use Trustpilot Reviews Scraper?

- **Reliable dataset creation** - Collect structured Trustpilot reviews with titles, ratings, text, dates, reviewer details, and company context without manual copying.
- **Automation-ready output** - Export results to JSON, CSV, Excel, XML, or connect to Google Sheets, webhooks, Make, and Zapier.
- **Use-case fit** - Supports reputation monitoring, competitor benchmarking, customer experience analysis, response tracking, and AI or RAG data collection.

## What data can you extract from Trustpilot?

| Field | Description |
|-------|-------------|
| `title` | Review title |
| `text` | Full review text |
| `rating` | Star rating from 1 to 5 |
| `published_date` | Date when the review was published |
| `is_verified` | Whether Trustpilot marks the review as verified |
| `reviewer_name` | Public reviewer display name |
| `reviewer_country` | Reviewer country code when available |
| `business_name` | Company display name on Trustpilot |
| `business_trust_score` | Business TrustScore when available |
| `company_reply_text` | Public company reply text when available |

## How to use Trustpilot Reviews Scraper

1. Open the actor on Apify Store.
2. Add one or more Trustpilot review URLs or plain company domains (for example, `apify.com`).
3. Set the maximum number of reviews and optional filters.
4. Choose a sort order and language filter if needed.
5. Run the actor.
6. Download the dataset or connect it to your workflow.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `urls` | Array | No | `["https://www.trustpilot.com/review/apify.com"]` | Trustpilot company review URLs or plain company domains such as `apify.com`. |
| `results_wanted` | Integer | No | `20` | Maximum number of reviews to save across all URLs. |
| `max_pages` | Integer | No | `10` | Maximum review pages to request per company. |
| `sort` | String | No | `"recency"` | Sort order: `recency` or `relevance`. |
| `languages` | String | No | `"all"` | Use `all` or a language code such as `en`, `de`, `fr`, `es`, or `it`. |
| `stars` | Integer | No | - | Optional star rating filter from 1 to 5. |
| `verified` | Boolean | No | `false` | Return only verified reviews when enabled. |
| `proxyConfiguration` | Object | No | Residential proxy | Proxy settings for reliable extraction. |

## Output Data

| Field | Type | Description |
|-------|------|-------------|
| `review_id` | String | Trustpilot review identifier. |
| `review_url` | String | Direct review URL when available. |
| `source_url` | String | Trustpilot page URL used for the record. |
| `source_page` | Integer | Review page number. |
| `business_domain` | String | Company domain from the Trustpilot page. |
| `business_name` | String | Trustpilot business display name. |
| `business_trust_score` | Number | Business TrustScore when available. |
| `business_review_count` | Integer | Total business review count when available. |
| `business_website` | String | Company website URL when available. |
| `business_is_claimed` | Boolean | Whether the business is claimed on Trustpilot. |
| `title` | String | Review title. |
| `text` | String | Full review text. |
| `rating` | Integer | Star rating from 1 to 5. |
| `language` | String | Review language code. |
| `review_source` | String | Review source type when available. |
| `is_verified` | Boolean | Whether Trustpilot marks the review as verified. |
| `verification_source` | String | Verification label or source when available. |
| `verification_level` | String | Verification level when available. |
| `is_pending` | Boolean | Whether the review is pending. |
| `is_filtered` | Boolean | Whether the review is filtered. |
| `likes_count` | Integer | Public likes count when available. |
| `published_date` | String | Date when the review was published. |
| `experience_date` | String | Date of the customer experience. |
| `reviewer_id` | String | Trustpilot reviewer identifier. |
| `reviewer_name` | String | Public reviewer display name. |
| `reviewer_country` | String | Reviewer country code when available. |
| `reviewer_review_count` | Integer | Public review count for the reviewer. |
| `reviewer_is_verified` | Boolean | Whether the reviewer is verified. |
| `consumers_review_count_on_same_domain` | Integer | Reviewer's total reviews on the same business domain. |
| `company_reply_text` | String | Public company reply text when available. |
| `company_reply_date` | String | Date of the company reply when available. |
| `company_reply_respondent_name` | String | Name of the person who replied for the company. |

## Usage Examples

### Basic Extraction

Collect the latest reviews from one company:

```json
{
  "urls": ["https://www.trustpilot.com/review/apify.com"],
  "results_wanted": 20,
  "max_pages": 2
}
```

### Multiple Companies

Use plain company domains and collect a shared result limit:

```json
{
  "urls": ["apify.com", "brightdata.com", "outscraper.com"],
  "results_wanted": 100,
  "max_pages": 5
}
```

### Filter Negative Reviews

Collect recent one-star reviews for support analysis:

```json
{
  "urls": ["https://www.trustpilot.com/review/example.com"],
  "stars": 1,
  "sort": "recency",
  "languages": "all",
  "results_wanted": 50
}
```

### Verified Reviews Only

Collect only verified reviews with company replies:

```json
{
  "urls": ["https://www.trustpilot.com/review/example.com"],
  "verified": true,
  "results_wanted": 30,
  "max_pages": 3
}
```

## Sample Output

```json
{
  "review_id": "abc123def456",
  "review_url": "https://www.trustpilot.com/review/apify.com?page=1",
  "source_url": "https://www.trustpilot.com/review/apify.com?page=1&sort=recency&languages=all",
  "source_page": 1,
  "business_domain": "apify.com",
  "business_name": "Apify",
  "business_trust_score": 4.8,
  "business_review_count": 622,
  "title": "Easy to use and reliable",
  "text": "Apify helped our team automate data collection and reduce manual work.",
  "rating": 5,
  "language": "en",
  "is_verified": true,
  "published_date": "2026-04-08T10:20:00.000Z",
  "experience_date": "2026-04-07T00:00:00.000Z",
  "reviewer_name": "Example Reviewer",
  "reviewer_country": "US",
  "likes_count": 3
}
```

## Tips for Best Results

- Use complete public Trustpilot review URLs in the format `https://www.trustpilot.com/review/company.com`. Plain domains are accepted and converted automatically.
- Start with `results_wanted` set to 20 for test runs. Increase for larger collection jobs.
- Use star filters when you need targeted sentiment slices such as only 1-star reviews.
- For larger or scheduled runs, residential proxies improve reliability. Configure proxy settings in the input.
- Some fields may be empty when the source page does not publish that information. Check multiple results before assuming the actor failed.
- Public Trustpilot pages can change over time. Report any issues through the Issues tab.

## Integrations

- **Google Sheets** - Send scraped reviews to spreadsheets for analysis and sharing.
- **Webhooks** - Trigger downstream workflows after each run.
- **Make or Zapier** - Connect results to no-code automations.
- **API** - Access datasets programmatically from your own systems.
- **Export formats** - Download datasets as JSON, CSV, Excel, XML, and other supported formats.

## Frequently Asked Questions

### Can I collect reviews from any Trustpilot company page?

Yes. Provide public Trustpilot review URLs or plain company domains. The actor normalizes them and collects reviews from the public review page.

### Can I scrape more than one company in a single run?

Yes. Add multiple URLs or domains to the `urls` parameter. The actor processes them in order until it reaches the `results_wanted` limit.

### Can I filter by star rating?

Yes. Set `stars` to a value from 1 to 5 to collect only that rating level. This is useful for focused sentiment analysis or support case review.

### Can I export the data to CSV or Excel?

Yes. Apify datasets can be downloaded in CSV, Excel, JSON, XML, and other supported formats from the Apify Console.

### Can I run this actor on a schedule?

Yes. You can schedule the actor in Apify Console to refresh data hourly, daily, weekly, or at another interval.

### Why should I use a proxy?

Trustpilot may limit traffic from some sources. Residential proxies improve reliability for production runs with larger page counts.

### Does the output include company replies?

Yes. When Trustpilot provides a public company reply, the output includes the reply text, date, and respondent name.

### What should I do if some fields are missing?

Some fields may be empty when the source page does not publish that information. Check multiple results before assuming the actor failed. If a field is consistently missing, open an issue with the target URL.

### Is it legal to scrape Trustpilot reviews?

Scraping public web data can be legal, but you are responsible for complying with applicable laws, Trustpilot terms, and privacy rules.

## Related Actors

- [Flipkart Reviews Scraper](https://apify.com/shahidirfan/flipkart-reviews-scraper)
- [App Store Reviews Scraper](https://apify.com/shahidirfan/app-store-reviews-scraper)
- [AliExpress Scraper](https://apify.com/shahidirfan/aliexpress-scraper)

## Support

For issues, feature requests, or custom actor work, use the Issues tab on the actor page or contact the developer through Apify.

## Legal Notice

This actor is designed for legitimate data collection from publicly available Trustpilot pages. Users are responsible for using the data responsibly and complying with applicable laws, Trustpilot terms, and privacy rules.
