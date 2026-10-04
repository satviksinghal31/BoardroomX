# Current draft verification

Contract v2 replaces the strict field-level v1 draft.

- Actual LAURUSLABS company HTML and package 1.0.0 financial response captured.
- Overview has all 19 specified display fields; source-unavailable values can be null.
- Financial tables converted to ordered labels, periods and source-text values. Missing cells retained as null, including TTM tax/dividend.
- Growth cards retained inside P&L. Missing 10-year price CAGR retained as null.
- Analysis and documents excluded from final JSON. Quarterly filing links retained.
- Four real chart images captured with the correct selected period. Chart datasets checked; four PNG signatures and unique hashes verified. 1-year image visually inspected.
- SBIN live response verified: Revenue, Financing Profit, Financing Margin and NPA labels retained; single ROE ratio row accepted.
- Current real sample passes section-level schema/QA. Individual unavailable data does not fail a category.
- Eight checks passed: actual sample accepted; images exist/are PNG/differ; individual blanks accepted; missing cash-flow section rejected; empty quarterly table rejected; missing chart range rejected; bank table shape accepted; shorter history accepted.
- Worker code and new DB tables/bucket are not implemented yet. Temporary scraping tools are outside the application dependency set.
