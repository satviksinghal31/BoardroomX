# BoardroomX

The active ingestion implementation is in `scrapers/`: a company-page-only Screener scraper and a durable sequential universe runner. See [usage and architecture](scrapers/README.md).

Each stock's standard JSON is stored in Supabase. The stock universe is preserved. No UI or recurring scheduler is implemented; the initial backfill is the current phase. The obsolete application, tables and chart storage have been retired.
