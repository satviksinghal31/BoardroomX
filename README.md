# BoardroomX

BoardroomX is a stock intelligence platform for NSE equities. It combines user watchlists, quarterly and annual fundamentals, price charts, RSI/EMA chart intelligence, NSE event-calendar tracking, and internal operations dashboards.

## App Location

The deployable app is:

```text
screener-tracker-onboarding/full
```

Railway should either deploy from that directory or use it as the service root.

## Production

```text
https://portfolio-tracker-production-fe7d.up.railway.app/
```

## Local Development

```bash
cd screener-tracker-onboarding/full
npm install
npm start
```

The app listens on `PORT`, defaulting to `3001`.

## Tests

```bash
cd screener-tracker-onboarding/full
npm test
```

## Agent Handoff

Use `AGENT_HANDOFF.md` for module ownership, deployment notes, and safe boundaries for outsourced development agents.

Use `screener-tracker-onboarding/full/CLAUDE.md` for deeper architecture context.
