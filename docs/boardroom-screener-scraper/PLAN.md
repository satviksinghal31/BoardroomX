# Boardroom Screener scraper release plan

Goal: publish one canonical single-company Python fetcher with independent QA, daily-refresh reliability and no batch orchestration.

Architecture: one requests/BeautifulSoup implementation at scrapers/boardroom_screener_scraper.py, caller-owned or per-call sessions, sequential paced optional enrichment and an explicit JSON contract. Offline fixtures/tests and CI are separate from the runtime file.

- [x] Create an isolated branch from remote main; preserve existing checkout and unrelated files.
- [x] Rename the runtime file and make existing regression fixtures portable.
- [ ] Run independent data-correctness, resilience and scalability QA agents; add reproductions for material findings before fixes.
- [ ] Fix meaningful issues without introducing workers, databases, browser dependencies or batch code.
- [ ] Run all portable tests in a clean dependency environment and validate selected public pages sequentially with Playwright.
- [ ] Document request throughput, output compatibility, partial failures and remaining upstream/access limitations.
- [ ] Commit only scoped release files, push the branch, and verify the remote commit and CI before reporting completion.

Completed: rename, three-agent QA, reproduced/fixed findings, 40 passing portable tests, clean dependency install, final live and Playwright checks, documentation and CI. GitHub branch publication follows verification.
