# Screener Single-Ticker Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, test, and package a reliable Python scraper that returns every available requested Screener section for one ticker.

**Architecture:** A small `screener_scraper` Python package separates HTTP/session behavior from deterministic BeautifulSoup parsing and the CLI. The scraper returns a versioned result with per-section status; it has no database dependency in this milestone.

**Tech Stack:** Python 3.9+, requests, BeautifulSoup4, unittest, Railway-compatible command line

---

### Task 1: Public contract and parsing helpers

**Files:**
- Create: `scripts/screener_scraper/__init__.py`
- Create: `scripts/screener_scraper/model.py`
- Create: `scripts/screener_scraper/parsers.py`
- Create: `tests/python/test_screener_parsers.py`
- Create: `tests/python/fixtures/standard_company.html`

- [ ] **Step 1: Write failing tests for ticker validation, numeric conversion, ratio aliases, annual tables, and section statuses**

```python
class ParserContractTests(unittest.TestCase):
    def test_standard_company_contract(self):
        result = parse_company_html(FIXTURE.read_text(), "TDPOWERSYS", SOURCE_URL, False)
        self.assertEqual(result["name"], "TD Power Systems Ltd")
        self.assertEqual(result["ratios_box"]["market_cap"], "₹ 6,500 Cr.")
        self.assertEqual(result["profit_loss"]["years"], ["Mar 2024", "Mar 2025"])
        self.assertEqual(result["section_status"]["profit_loss"]["status"], "ok")
```

- [ ] **Step 2: Run the parser tests and verify they fail because the package does not exist**

Run: `python3 -m unittest tests/python/test_screener_parsers.py -v`

Expected: import failure for `screener_scraper`.

- [ ] **Step 3: Implement the public model, validation, and deterministic section parsers**

Implement `ScraperConfig`, typed exceptions, `sanitize_ticker`, `canonical_section`, `to_number`, table parsing, section parsing, UTC metadata, and the versioned output contract. Preserve original labels while adding snake-case ratio aliases.

- [ ] **Step 4: Run the parser tests and verify they pass**

Run: `python3 -m unittest tests/python/test_screener_parsers.py -v`

Expected: all Task 1 tests pass.

- [ ] **Step 5: Commit the parser contract**

```bash
git add scripts/screener_scraper tests/python
git commit -m "feat: add Screener company parsers"
```

### Task 2: Section coverage and malformed-page resilience

**Files:**
- Modify: `scripts/screener_scraper/parsers.py`
- Modify: `tests/python/test_screener_parsers.py`
- Create: `tests/python/fixtures/bank_company.html`
- Create: `tests/python/fixtures/partial_company.html`
- Create: `tests/python/fixtures/wiki_commentary.html`

- [ ] **Step 1: Add failing tests for all requested sections**

Test pros/cons, peers and footer, quarterly results, P&L, balance sheet, cash flow, ratios, four growth-range groups, quarterly/yearly shareholding, document categories with absolute URLs, bank labels, missing optional sections, and wiki commentary.

- [ ] **Step 2: Run the focused tests and verify the missing coverage fails**

Run: `python3 -m unittest tests/python/test_screener_parsers.py -v`

Expected: failures identify unimplemented or misclassified sections.

- [ ] **Step 3: Implement only the parsers needed by the failing tests**

Every requested section returns a stable empty shape plus a section status of `ok`, `unavailable`, or `failed`. Parser failures remain isolated to their section. Resolve relative document links against `https://www.screener.in`.

- [ ] **Step 4: Run parser tests and verify all pass**

Run: `python3 -m unittest tests/python/test_screener_parsers.py -v`

Expected: all parser tests pass with no network access.

- [ ] **Step 5: Commit complete section parsing**

```bash
git add scripts/screener_scraper/parsers.py tests/python
git commit -m "feat: parse complete Screener company pages"
```

### Task 3: HTTP client, authentication, and fallback

**Files:**
- Create: `scripts/screener_scraper/client.py`
- Modify: `scripts/screener_scraper/__init__.py`
- Create: `tests/python/test_screener_client.py`

- [ ] **Step 1: Add failing client tests with a fake requests session**

Cover bounded timeouts, retry configuration, typed 404/429/network failures, authenticated wiki requests, consolidated URL selection, standalone fallback only when consolidated annual P&L is absent, context-manager cleanup, section filtering, and `compute_cagr` edge cases.

- [ ] **Step 2: Run the client tests and verify they fail for missing behavior**

Run: `python3 -m unittest tests/python/test_screener_client.py -v`

Expected: failures for missing `ScreenerScraper` behavior.

- [ ] **Step 3: Implement the requests client and public `ScreenerScraper` API**

Use one session, explicit connect/read timeout, bounded retries with `Retry-After`, credentials from constructor or environment, and typed exceptions. Do not log or serialize credentials. `scrape_section()` returns the named section, not the entire company payload.

- [ ] **Step 4: Run client and parser tests**

Run: `python3 -m unittest discover -s tests/python -p 'test_screener_*.py' -v`

Expected: all tests pass.

- [ ] **Step 5: Commit the scraper client**

```bash
git add scripts/screener_scraper tests/python/test_screener_client.py
git commit -m "feat: add robust Screener HTTP client"
```

### Task 4: Single-ticker CLI and packaging

**Files:**
- Create: `scripts/screener_scraper/cli.py`
- Create: `scripts/screener_scraper/__main__.py`
- Create: `requirements-screener.txt`
- Modify: `package.json`
- Create: `tests/python/test_screener_cli.py`
- Modify: `.env.example`

- [ ] **Step 1: Add failing CLI tests**

Test `--ticker`, `--statement`, `--out-dir`, `--sections`, `--list-sections`, credential environment variables, verbose logging, non-zero exit codes, and atomic JSON output.

- [ ] **Step 2: Run CLI tests and verify they fail**

Run: `python3 -m unittest tests/python/test_screener_cli.py -v`

Expected: missing CLI module or behavior.

- [ ] **Step 3: Implement the CLI and dependency manifest**

Expose `python3 -m scripts.screener_scraper --ticker TDPOWERSYS` and an npm convenience command. Use a temporary file followed by `Path.replace()` for atomic output.

- [ ] **Step 4: Run all Python and existing Node tests**

Run: `python3 -m unittest discover -s tests/python -p 'test_screener_*.py' -v`

Run: `npm test`

Expected: both suites pass.

- [ ] **Step 5: Commit the CLI**

```bash
git add scripts/screener_scraper tests/python/test_screener_cli.py requirements-screener.txt package.json .env.example
git commit -m "feat: add single-ticker Screener CLI"
```

### Task 5: Representative live verification and deployment handoff

**Files:**
- Create: `scripts/verify-screener-single.py`
- Create: `docs/screener-scraper.md`
- Modify: `tests/python/test_screener_cli.py`

- [ ] **Step 1: Add a failing test for the verification report contract**

The verifier must report ticker, statement chosen, required P&L availability, per-section status, duration, and failure reason without treating optional unavailable sections as fatal.

- [ ] **Step 2: Implement the opt-in verifier and operator documentation**

Document installation, library examples, CLI flags, credentials, exit codes, JSON contract, and the Railway one-off command.

- [ ] **Step 3: Run offline verification**

Run: `python3 -m unittest discover -s tests/python -p 'test_screener_*.py' -v`

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 4: Run live verification against five representative universe symbols**

Run: `python3 scripts/verify-screener-single.py TDPOWERSYS TCS HDFCBANK JIOFIN KPIGREEN`

Expected: each existing ticker returns annual P&L; optional sections are populated or explicitly classified. Any network or parser failure is recorded and investigated before deployment.

- [ ] **Step 5: Commit Milestone 1 and prepare the Railway one-off command**

```bash
git add scripts/verify-screener-single.py docs/screener-scraper.md tests/python
git commit -m "docs: verify single-ticker Screener scraper"
```

- [ ] **Step 6: Deploy Milestone 1 and run `TDPOWERSYS` in Railway**

Use the existing Railway project only after local verification is green. Confirm the deployed command exits successfully and produces the same required contract.
