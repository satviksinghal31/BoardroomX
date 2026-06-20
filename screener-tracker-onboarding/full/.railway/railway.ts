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
      PORT: preserve(),
      SCREENER_EMAIL: preserve(),
      SCREENER_PASSWORD: preserve(),
      SUPABASE_ANON_KEY: preserve(),
      SUPABASE_DB_URL: preserve(),
      SUPABASE_SERVICE_ROLE_KEY: preserve(),
      SUPABASE_URL: preserve(),
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
    resources: [eventsCron, universeMcap, portfolioTrackerService, screenerAnnuals],
  });
});
