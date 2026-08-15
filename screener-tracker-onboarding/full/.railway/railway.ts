import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const portfolioRepo = github("satviksinghal31/BoardroomX", {
    branch: "main",
    rootDirectory: "screener-tracker-onboarding/full",
  });

  const portfolioTrackerService = service("portfolio-tracker", {
    source: portfolioRepo,
    replicas: 1,
    env: {
      DHAN_CLIENT_ID: preserve(),
      DHAN_PIN: preserve(),
      DHAN_TOTP_SECRET: preserve(),
      PORT: preserve(),
      SCREENER_EMAIL: preserve(),
      SCREENER_PASSWORD: preserve(),
      SUPABASE_ANON_KEY: preserve(),
      SUPABASE_DB_URL: preserve(),
      SUPABASE_SERVICE_ROLE_KEY: preserve(),
      SUPABASE_URL: preserve(),
    },
  });

  const eventsCron = service("events-cron", {
    source: portfolioRepo,
    start: "npm run cron:events",
    replicas: 1,
    deploy: { cronSchedule: "30 2,14 * * *", restartPolicyType: "NEVER" },
    env: {
      DISABLE_JOBS: preserve(),
      SCREENER_EMAIL: portfolioTrackerService.env.SCREENER_EMAIL,
      SCREENER_PASSWORD: portfolioTrackerService.env.SCREENER_PASSWORD,
      SUPABASE_ANON_KEY: portfolioTrackerService.env.SUPABASE_ANON_KEY,
      SUPABASE_DB_URL: portfolioTrackerService.env.SUPABASE_DB_URL,
      SUPABASE_SERVICE_ROLE_KEY: portfolioTrackerService.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_URL: portfolioTrackerService.env.SUPABASE_URL,
    },
  });
  const eodMarketCap = service("eod-market-cap", {
    source: portfolioRepo,
    start: "npm run cron:eod-market-cap",
    replicas: 1,
    deploy: { cronSchedule: "0 13 * * *", restartPolicyType: "NEVER" },
    env: {
      DISABLE_JOBS: preserve(),
      SUPABASE_ANON_KEY: portfolioTrackerService.env.SUPABASE_ANON_KEY,
      SUPABASE_DB_URL: portfolioTrackerService.env.SUPABASE_DB_URL,
      SUPABASE_SERVICE_ROLE_KEY: portfolioTrackerService.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_URL: portfolioTrackerService.env.SUPABASE_URL,
    },
  });

  const dhanInstrumentSync = service("dhan-instrument-sync", {
    source: portfolioRepo,
    start: "npm run cron:dhan-instrument-sync",
    replicas: 1,
    deploy: { cronSchedule: "0 2 * * *", restartPolicyType: "NEVER" },
    env: {
      DHAN_CLIENT_ID: portfolioTrackerService.env.DHAN_CLIENT_ID,
      DHAN_PIN: portfolioTrackerService.env.DHAN_PIN,
      DHAN_TOTP_SECRET: portfolioTrackerService.env.DHAN_TOTP_SECRET,
      SUPABASE_ANON_KEY: portfolioTrackerService.env.SUPABASE_ANON_KEY,
      SUPABASE_DB_URL: portfolioTrackerService.env.SUPABASE_DB_URL,
      SUPABASE_SERVICE_ROLE_KEY: portfolioTrackerService.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_URL: portfolioTrackerService.env.SUPABASE_URL,
    },
  });

  const dhanEodUpdate = service("dhan-eod-update", {
    source: portfolioRepo,
    start: "npm run cron:dhan-eod-update",
    replicas: 1,
    deploy: { cronSchedule: "30 10 * * *", restartPolicyType: "NEVER" },
    env: {
      DISABLE_JOBS: preserve(),
      SUPABASE_ANON_KEY: portfolioTrackerService.env.SUPABASE_ANON_KEY,
      SUPABASE_DB_URL: portfolioTrackerService.env.SUPABASE_DB_URL,
      SUPABASE_SERVICE_ROLE_KEY: portfolioTrackerService.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_URL: portfolioTrackerService.env.SUPABASE_URL,
    },
  });

  const dhanLiveFeed = service("dhan-live-feed", {
    source: portfolioRepo,
    start: "npm run dhan:worker",
    replicas: 1,
    env: {
      DHAN_CLIENT_ID: portfolioTrackerService.env.DHAN_CLIENT_ID,
      DHAN_PIN: portfolioTrackerService.env.DHAN_PIN,
      DHAN_TOTP_SECRET: portfolioTrackerService.env.DHAN_TOTP_SECRET,
      SUPABASE_ANON_KEY: portfolioTrackerService.env.SUPABASE_ANON_KEY,
      SUPABASE_DB_URL: portfolioTrackerService.env.SUPABASE_DB_URL,
      SUPABASE_SERVICE_ROLE_KEY: portfolioTrackerService.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_URL: portfolioTrackerService.env.SUPABASE_URL,
    },
  });
  const screenerAnnuals = service("screener-annuals", {
    source: portfolioRepo,
    start: "npm run cron:screener-annuals",
    replicas: 1,
    deploy: { cronSchedule: "* * * * *", restartPolicyType: "NEVER" },
    env: {
      DISABLE_JOBS: preserve(),
      SCREENER_EMAIL: portfolioTrackerService.env.SCREENER_EMAIL,
      SCREENER_PASSWORD: portfolioTrackerService.env.SCREENER_PASSWORD,
      SUPABASE_ANON_KEY: portfolioTrackerService.env.SUPABASE_ANON_KEY,
      SUPABASE_DB_URL: portfolioTrackerService.env.SUPABASE_DB_URL,
      SUPABASE_SERVICE_ROLE_KEY: portfolioTrackerService.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_URL: portfolioTrackerService.env.SUPABASE_URL,
    },
  });
  const quarterlyResults = service("quarterly-results", {
    source: portfolioRepo,
    start: "npm run cron:quarterly-results",
    replicas: 1,
    deploy: { cronSchedule: "*/5 * * * *", restartPolicyType: "NEVER" },
    env: {
      SUPABASE_ANON_KEY: portfolioTrackerService.env.SUPABASE_ANON_KEY,
      SUPABASE_DB_URL: portfolioTrackerService.env.SUPABASE_DB_URL,
      SUPABASE_SERVICE_ROLE_KEY: portfolioTrackerService.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_URL: portfolioTrackerService.env.SUPABASE_URL,
    },
  });

  return project("pretty-sparkle", {
    resources: [
      eventsCron,
      eodMarketCap,
      portfolioTrackerService,
      screenerAnnuals,
      quarterlyResults,
      dhanInstrumentSync,
      dhanEodUpdate,
      dhanLiveFeed,
    ],
  });
});
