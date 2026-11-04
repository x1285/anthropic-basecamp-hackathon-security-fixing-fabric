# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Nature of this repo

This is not a code project: there is no build, lint, or test tooling. It is a synthetic, fictional "enterprise" data repo (see `README.md`) that serves as the working environment for an Always-On Ops Agent (a Claude Code routine). All companies, people, errors, and contract terms are made up. The agent reads these files and acts on them (triage incidents, scan contracts), so edits are to data/docs, not code.

## Layout and how the pieces relate

- `issues/PROD-*.json` — open production incidents. Fields: `id`, `title`, `status`, `severity` (often `null` = untriaged), `labels`, `assignee`, `opened_at`, `reporter`, `body`, `comments`. Triage means filling in severity/labels/assignee/comments.
- `deploys/recent.json` — deploy log (`service`, `version`, `deployed_at`, `commit`, `summary`, `files_changed`, `rollback_available`, `last_known_good`). Used to correlate an incident's `opened_at` with recent deploys *and* config/feature-flag changes (e.g. `tenant-config-service` flag rollouts count as deploys). Entries are not sorted chronologically, so compare timestamps rather than relying on order. Note `rollback_available: false` (e.g. auth-service v6.0.0) rules out rollback as a remedy.
- `runbooks/*.md` — playbooks with Symptoms / Root cause / Fix / Don't sections. Match an incident's symptoms to a runbook, and respect the "Don't" lists. Runbooks only apply when symptoms match (e.g. the 502 runbook assumes *no related deploys*).
- `contracts/*.md` — vendor MSAs (Card C: Compliance Drift).
- `compliance-policy.md` — the rules the compliance routine checks each contract in `contracts/` against: EU data residency, audit notice (≤90 days, at least 30), termination for convenience (≤90 days), liability cap (≥12 months of fees, including data breach), subprocessor notice (≥30 days before adding), breach notification (≤72h), and governing-law jurisdiction. Violations are reported as opened issues.

## `bloodhound/` — design doc for a separate agent

`bloodhound/` holds only a concept doc ("Bloodhound – Concept & Architecture (First Draft).md", staged but not yet committed), no code or data. It describes a *different* always-on agent: security-incident (OSV-style CVE payload) → grouped fixes across repos/environments → tested PRs, with human approval of every customer-facing text. Key ideas to keep consistent if you touch it:

- Customers attach to *environments*, not projects; an environment's effective SLA is the strictest SLA among its customers, and the clock starts at detection (approval wait time counts).
- Repos needing the same fix are grouped, one reusable "recipe" per group (stored in memory, updated with learnings after each repo).
- The agent never merges or deploys itself; it stops at a tested PR or prepared deploy request. A repo counts as fixed only when the deployed release in each affected environment is re-scanned as safe.
- Step 8 (escalation) rules and several items under "Open questions" are explicit assumptions, not decisions. Don't present them as settled.

This doc is unrelated to the `issues/`, `deploys/`, `runbooks/`, `contracts/` data above; don't mix the two domains.

## Workflow notes

- README mentions a seeding flow (`gh repo create ... --private --clone`, copy files in, push) and pointing a routine at the resulting GitHub repo via the Routines UI.
- Git history is minimal (single upload commit on `main`); `.idea/` is untracked IDE state. The git root is the `always-on-agent/` directory (the parent of `bloodhound/`), so this CLAUDE.md applies to both.
