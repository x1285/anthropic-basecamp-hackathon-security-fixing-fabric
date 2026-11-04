# CLAUDE.md (bloodhound/)

Guidance for working in the Bloodhound code. The parent `../CLAUDE.md` describes the other data repo and still applies to this folder.

## Rules
- No Git and no GitHub. Safety points are snapshots: `pnpm gate -- --phase=PN` writes `.snapshots/PN/`.
- Never read `.env` aloud or copy it anywhere. The API key lives there. Snapshots and the gate skip `.env*`.
- `mockdata/` is the fake world. `mockdata/repos/*` is read-only: the sandbox works only in `.work/<run>/<repo>/`. Regenerate the world with `node scripts/gen-mockdata.mjs`.
- DB tests and E2E must run against `bloodhound_test`: use `pnpm test` and `pnpm test:e2e`. `seed()` wipes all Bloodhound tables.
- Adapters: external systems sit behind interfaces in `packages/adapters`. Only fakes exist in this build.
- LLM calls go through `packages/agent` (`callJson`). Modes via `BLOODHOUND_LLM`: `replay` (default), `live`, `off`. Fallback templates are the deterministic path.

## Commands
- `pnpm db:up` starts Postgres in Docker. Requires Docker running.
- `pnpm db:migrate` applies migrations to the dev DB. For the test DB: `pnpm exec dotenv -e .env.test -- prisma migrate deploy`.
- `pnpm seed` loads `mockdata/` into the dev DB.
- `pnpm typecheck`, `pnpm test`, `pnpm build:web`, `pnpm test:e2e`, `pnpm gate`.
- Single test file: `pnpm exec dotenv -e .env.test -- vitest run packages/core/test/core.test.ts`.

## Layout
- `packages/core`: pure domain logic (semver, OSV parsing, scan, SLA, grouping, priority). No I/O.
- `packages/sandbox`: copy, recipe application, simulated tests, diff.
- `packages/agent`: LLM access (`index.ts`) and concrete tasks (`tasks.ts`) with templates.
- `packages/adapters`: interfaces and fakes.
- `packages/engine`: pipeline on Prisma (`pipeline.ts`), seed, paths and env loading.
- `apps/web`: Next.js UI and the webhook `POST /api/incidents`. Server actions in `app/actions.ts`.

## Invariants
- A repo counts as fixed only after the merged lockfile is re-scanned as safe in every affected environment (`mergeAndDeploy`).
- Effective SLA of an environment: strictest customer SLA; floor only without customers.
- A recipe lives once per signature (`paket|version|strategy`) and is shared across runs.
- Customer texts are not sent out before approval (`approveMessage`).
- Config defaults are in `pipeline.CONFIG`. Decisions are logged in `docs/decisions.md`.
