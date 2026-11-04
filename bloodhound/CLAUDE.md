# CLAUDE.md (bloodhound/)

Guidance for working in the Bloodhound code. The parent `../CLAUDE.md` describes the other data repo and still applies to this folder.

## Rules
- The target UI is `Bloodhound.html` in this folder. The Next.js app is a React port of it (same markup, copy and styles). Change the behaviour in `packages/core` first, then the port.
- Never read `.env` aloud or copy it anywhere. The API key lives there. The gate and snapshots skip `.env*`.
- DB tests and E2E must run against `bloodhound_test`: use `pnpm test` and `pnpm test:e2e`. `seedDatabase()` wipes all Bloodhound tables.
- The demo world is code (`packages/core/src/seed.ts`), mirroring the prototype's seed. There are no mock repo folders.
- Adapters: external systems would sit behind interfaces in `packages/adapters`. The current flow does not use them.
- LLM calls go through `packages/agent` (`callJson`, Haiku only). The current mock flow makes no model calls; grouping and recipes are simulated as in the prototype.

## Commands
- `pnpm db:up` starts Postgres in Docker. Requires Docker running.
- `pnpm db:migrate` applies migrations to the dev DB. For the test DB: `pnpm exec dotenv -e .env.test -- prisma migrate deploy`.
- `pnpm seed` loads the demo world into the dev DB.
- `pnpm typecheck`, `pnpm test`, `pnpm build:web`, `pnpm test:e2e`, `pnpm gate`.
- Single test file: `pnpm exec dotenv -e .env.test -- vitest run packages/core/test/core.test.ts`.

## Layout
- `packages/core`: pure domain logic, no I/O, browser-safe. `model.ts` (types), `versions.ts`, `evaluate.ts` (scan, verdicts, SLA), `plan.ts` (groups, recipes, pilot, priority), `run.ts` (build and fix a run, notices, webhook payload), `repo-input.ts` (fake repos, manifests), `world.ts` (edits), `seed.ts`.
- `packages/agent`: LLM access (`index.ts`) and tasks with templates. Not used by the current flow.
- `packages/adapters`: interfaces and fakes. Not used by the current flow.
- `packages/engine`: Prisma persistence (`store.ts`), `service.ts` (the single `mutate` entry point), seed, paths and env loading.
- `apps/web`: `app/bloodhound-app.tsx` (the UI), `app/actions.ts` (server action), `app/api/incidents` (webhook), `app/globals.css` (copied from `Bloodhound.html`).
- `prisma/schema.prisma`: relational world, run snapshot in `Run.data`.

## Invariants
- A repo counts as fixed only after its deployed release is re-scanned as safe in every affected environment (`verify`).
- Effective SLA of an environment: strictest customer SLA; the environment's fallback applies only without customers.
- Customer notices are not sent before approval (`approveNotice`); a resolution only goes to customers whose projects are all verified.
- Stored numbers never use Infinity (JSON cannot carry it); null means "no SLA".
- Decisions are logged in `docs/decisions.md`.
