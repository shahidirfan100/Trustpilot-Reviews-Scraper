# Trustpilot Reviews Scraper

Extract Trustpilot reviews from public company review pages. Collect review text, star ratings, dates, reviewer details, verification signals, business TrustScore, and company replies for reputation monitoring, competitor research, and customer feedback analysis.

## Features

- **Multiple URL input** - Add one or many Trustpilot review URLs or plain company domains.
- **Review pagination** - Collect reviews across pages until your result or page limit is reached.
- **Rating filters** - Focus on one star level when you need sentiment-specific datasets.
- **Language filters** - Collect all languages or target a specific Trustpilot language code.
- **Clean output** - Empty and unavailable values are removed before records are saved.
- **Business context** - Include company name, domain, TrustScore, and review counts when available.

---

## Use Cases

### Reputation Monitoring

Track recent customer feedback for your own brand. Use ratings, review text, dates, and replies to spot changes in customer sentiment and support quality.

### Competitor Research

Compare public reviews across similar companies. Collect review titles, ratings, and reviewer metadata to identify recurring praise, complaints, and service gaps.

### Customer Experience Analysis

Build datasets for text analysis, dashboards, and reporting. Filter by star rating or language to study specific customer segments.

### Response Tracking

Review public company replies alongside the original customer feedback. This helps teams measure response coverage and tone over time.

---

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

---

## Output Data

Each saved review may contain:

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
| `title` | String | Review title. |
| `text` | String | Full review text. |
| `rating` | Integer | Star rating from 1 to 5. |
| `language` | String | Review language code. |
| `is_verified` | Boolean | Whether Trustpilot marks the review as verified. |
| `verification_source` | String | Verification label or source when available. |
| `published_date` | String | Date when the review was published. |
| `experience_date` | String | Date of the customer experience. |
| `likes_count` | Integer | Public likes count when available. |
| `reviewer_name` | String | Public reviewer display name. |
| `reviewer_country` | String | Reviewer country code when available. |
| `reviewer_review_count` | Integer | Public review count for the reviewer. |
| `company_reply_text` | String | Public company reply text when available. |
| `company_reply_date` | String | Date of the company reply when available. |

---

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

---

## Sample Output

```json
{
  "review_id": "example-review-id",
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
  "reviewer_country": "US"
}
```

---

## Tips for Best Results

### Use Company Review Pages

- Prefer URLs in the format `https://www.trustpilot.com/review/company.com`.
- Plain domains are accepted and converted automatically.
- Localized Trustpilot URLs are normalized to the main review URL.

### Keep Test Runs Small

- Start with `results_wanted` set to 20.
- Increase `max_pages` for larger collection jobs.
- Use star filters when you need targeted sentiment slices.

### Configure Proxies

For larger or scheduled runs, residential proxies are recommended:

```json
{
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

---

## Integrations

Connect your Trustpilot review data with:

- **Google Sheets** - Review and label customer feedback.
- **Airtable** - Build searchable research databases.
- **Slack** - Send alerts for new low-rating reviews.
- **Webhooks** - Deliver records to your own systems.
- **Make** - Create automated monitoring workflows.
- **Zapier** - Trigger follow-up actions.

### Export Formats

- **JSON** - For developers and data pipelines.
- **CSV** - For spreadsheet analysis.
- **Excel** - For reporting and sharing.
- **XML** - For system integrations.

---

## Frequently Asked Questions

### Can I scrape any Trustpilot company page?

Yes, you can provide public Trustpilot company review pages or plain company domains.

### Can I collect more than one company in a run?

Yes, add multiple values to `urls` and the actor will process them in order until it reaches `results_wanted`.

### Can I filter by star rating?

Yes, set `stars` to a value from 1 to 5 to collect only that rating level.

### Why should I use a proxy?

Trustpilot may limit some traffic sources, so residential proxies improve reliability for production runs.

### Are empty fields saved?

No, unavailable null or empty values are removed from each dataset item.

### Does this include company replies?

Yes, public company reply text and reply dates are included when Trustpilot provides them.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection from public pages. Users are responsible for ensuring compliance with Trustpilot terms, privacy rules, and applicable laws. Use collected data responsibly and respect rate limits.
