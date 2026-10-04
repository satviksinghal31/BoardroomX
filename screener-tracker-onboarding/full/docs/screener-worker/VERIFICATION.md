# Draft verification

- Real network fetch: LAURUSLABS consolidated, package 1.0.0; exact fetch time in fetch-metadata.json.
- Original HTML retained locally in outputs/screener-contract/LAURUSLABS.source.html.
- All nine package sections captured. Overview/top metrics extracted from the same HTML.
- Quarterly and yearly shareholding separated using package table parser on each original table.
- Schema checked with Ajv 8.17.1 in strict mode.
- Real sample: FAIL, 78 validation findings at 60 distinct locations. Some locations trigger multiple schema rules.
- Six checks passed: synthetic complete data accepted, missing section rejected, missing period cell rejected, deleted source row rejected, blank company name rejected, numeric zero accepted. Synthetic data was used only in memory to exercise validation; the saved sample remains entirely real.
- No DB tables created, no worker started, no scraper added to application dependencies.
