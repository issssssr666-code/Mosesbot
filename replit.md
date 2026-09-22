# BTC Market Console

A focused Bitcoin market-analysis console for reviewing price action, signals, risk context, and validation checks.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/btc-market-console/src/App.tsx` — single-screen market console and local deterministic analysis data
- `artifacts/btc-market-console/src/index.css` — console theme, motion, chart, and responsive layout tokens
- `artifacts/api-server` — shared API service scaffold for future live-data integrations

## Architecture decisions

- The first console surface uses deterministic local data so the analysis experience remains available without third-party credentials or rate limits.
- The frontend owns its interaction state for timeframe changes, watchlist selection, refresh feedback, notification visibility, and validation filters.

## Product

- Market overview with BTC price action and selectable timeframes
- Watchlist for BTC, ETH, SOL, DXY, and NDX context
- Analyst brief with posture, bias, conviction, and risk
- Risk dashboard and filterable validation checks

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
