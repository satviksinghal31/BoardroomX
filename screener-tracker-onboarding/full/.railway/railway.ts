import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const portfolioRepo = github("satviksinghal31/BoardroomX", {
    branch: "main",
    rootDirectory: "screener-tracker-onboarding/full",
  });

  const eventsCron = service("events-cron", {
    source: portfolioRepo,
    start: "npm run cron:events",
    replicas: 1,
    deploy: { cronSchedule: "30 2,14 * * *", restartPolicyType: "NEVER" },
    env: {
      SCREENER_EMAIL: preserve(),
      SCREENER_PASSWORD: preserve(),
      SUPABASE_ANON_KEY: preserve(),
      SUPABASE_DB_URL: preserve(),
      SUPABASE_SERVICE_ROLE_KEY: preserve(),
      SUPABASE_URL: preserve(),
    },
  });
  const universeMcap = service("universe-mcap", {
    source: portfolioRepo,
    start: "npm run cron:universe-mcap",
    replicas: 1,
    deploy: { cronSchedule: "0 13 * * *", restartPolicyType: "NEVER" },
    env: {
      SCREENER_EMAIL: preserve(),
      SCREENER_PASSWORD: preserve(),
      SUPABASE_ANON_KEY: preserve(),
      SUPABASE_DB_URL: preserve(),
      SUPABASE_SERVICE_ROLE_KEY: preserve(),
      SUPABASE_URL: preserve(),
    },
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
      SCREENER_EMAIL: portfolioTrackerService.env.SCREENER_EMAIL,
      SCREENER_PASSWORD: portfolioTrackerService.env.SCREENER_PASSWORD,
      SUPABASE_ANON_KEY: portfolioTrackerService.env.SUPABASE_ANON_KEY,
      SUPABASE_DB_URL: portfolioTrackerService.env.SUPABASE_DB_URL,
      SUPABASE_SERVICE_ROLE_KEY: portfolioTrackerService.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_URL: portfolioTrackerService.env.SUPABASE_URL,
    },
  });

  return project("pretty-sparkle", {
    resources: [
      eventsCron,
      universeMcap,
      portfolioTrackerService,
      screenerAnnuals,
      dhanInstrumentSync,
      dhanEodUpdate,
      dhanLiveFeed,
    ],
  });
});
