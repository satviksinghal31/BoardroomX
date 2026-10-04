# BoardroomX

The previous application has been retired. The canonical app is `screener-tracker-onboarding/full`.

This cleanup retains the existing database stock universe. Authentication, sign-in, sign-up, session handling, and profile flows have been removed. There are no scraping routes, background workers, cron jobs, Dhan calls, or legacy dashboards in this application. The new worker is a separate implementation step.

Run `npm ci`, `npm test`, and `npm start` from the canonical app directory. Set the variables in `.env.example`. `/health` reports process health, not database connectivity.

Database cleanup: `database/cleanup-legacy.sql` is an explicit transactional removal list. It keeps stock-universe tables and the existing market_universe view and market-cap dependency. `database/remove-app-auth.sql` removes the application profile table and signup trigger. Supabase-managed Auth records are not used by the app. Apply only after old deployed workers are stopped. No automatic cleanup runs on server startup.
