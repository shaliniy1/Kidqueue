# Data Scrapper (Idea of the Day)

Local web UI + data scrapper for Idea of the Day pages. It crawls pages, captures sections, and saves PDFs per idea page.

## Run (Web UI)
```bash
cd "/Users/shalini/Documents/New project/scrapper"
npm install
npx playwright install chromium
npm run server
```

Open:
`http://localhost:3000`

Enter the target URL in the UI before starting.

## CLI run (optional)
```bash
npm run scrape
```

## Output
`output/scrapper-<timestamp>-<runId>/`
- `summary.json`
- `pages/<slug>/page.pdf`
- `pages/<slug>/content.json|content.txt|content.html`

## Config (advanced)
Same env vars as the CLI:
- `IDEA_BASE_URL` (required)
- `SEED_URLS`
- `LINK_INCLUDE`, `LINK_EXCLUDE`
- `CRAWL_INCLUDE`
- `LINK_REGEX`
- `MAX_CRAWL_PAGES`, `MAX_IDEA_PAGES`
- `NAV_TIMEOUT_MS`
- `HEADLESS`, `SLOW_MO_MS`
- `OUTPUT_DIR`
