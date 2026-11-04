# Bloodhound – Build-Report

Stand: 4. Nov. 2026. Gate-Lauf mit Snapshot `.snapshots/P0/`: **GRÜN**.

## Gate-Ergebnis

| Schritt | Ergebnis |
|---|---|
| Postgres (docker compose, healthy) | PASS |
| Migrationen dev und test | PASS (3 Migrationen) |
| Typecheck (core, adapters, agent, sandbox, engine, web) | PASS |
| Vitest: Core-Unit, Adapter-Contracts, Engine-Integration, Parallel-Smoke | PASS, 27 Tests |
| Web-Build (Next.js 15) | PASS |
| Playwright E2E, Demo-Schritte 1–9 | PASS, 1 Szenario |

## Status je Phase

| Phase | Status | Anmerkung |
|---|---|---|
| P0 Fundament | erledigt | Monorepo, Postgres in Docker, Prisma-Schema, Mockdaten (4 Projekte, 12 Envs, 12 Kunden, 10 Repos, 4 Incidents), Seed, Adapter mit Fakes, Gate |
| P1 MVP | erledigt | Webhook `POST /api/incidents`, Demo-Lab, environment-aware Scan, SLA (strengster Kunde, Floor ohne Kunden, Uhr ab Detection), Dashboard |
| P2 Kommunikation | erledigt | Kundentext-Entwurf, Inbox mit Freigabe, Fan-out in die Outbox (10 Kopien für INC-1), Approval-Timer (10 % SLA, nur angezeigt), Auflösungsnachricht |
| P3 Gruppierung & Rezepte | erledigt | Signatur-Gruppierung, Begründung je Gruppe, Rezept-Gedächtnis, Priorisierung |
| P4 Pilot-Fixing | erledigt | Pilotwahl, Sandbox in `.work/`, 3 Versuche / 30 min, Rezept-Revision nach Pilotfehler, Learnings nach jedem Repo, simulierte PRs |
| P5 Abschluss & Lernen | erledigt, mit Lücken | Eskalation mit Ticket-Entwurf, SLA-Alarm (Anzeige), verifizierter Abschluss über Re-Scan, Rezept-Wiederverwendung. At-Risk-Flagging **nicht gebaut** (Flag vorhanden, aus) |
| P6 Produktionsreife (lokal) | teilweise | Adapter-Contract-Tests gegen Fakes: ja. Audit-Log: ja (Freigaben, Merges, Eskalationen). **Nicht gebaut:** Rollen und Login (Freigabe läuft als fester Akteur `ui-approver`). Pseudonymisierung: Kundendaten gehen nicht an das Modell (D8) |
| P7 Final v1 | teilweise | Defaults als Konstanten verbindlich (`pipeline.CONFIG`). Parallel-Smoke mit 8 Incidents: PASS. **Nicht gebaut:** Mehrsprachigkeit und Templates, gemeinsamer Fix für Multi-Repo-Projekte, Traces und Kosten pro Incident, SLA-Reporting, Neustart-Test mitten im Run |

## Wichtig: LLM-Anbindung noch nicht im Live-Betrieb

- `.env` mit `ANTHROPIC_API_KEY` ist **noch nicht vorhanden**. Deshalb lief das Gate mit `BLOODHOUND_LLM=replay`.
- Es gibt **keine aufgezeichneten Fixtures** in `fixtures/llm/`. Alle LLM-Aufgaben (Rezept, Gruppen-Begründung, Kundentext, Lernnotiz) liefen über die deterministischen Vorlagen.
- Der Live-Smoke pro Phase ist **nicht gelaufen**. Er wird fällig, sobald die `.env` da ist: `BLOODHOUND_LLM=live pnpm seed` und danach einen Incident auslösen. Die Antworten landen dann als Fixtures in `fixtures/llm/`, und das Gate läuft danach offline gegen diese Fixtures.

## Bekannte Lücken und Risiken

- **Pilot-Revision und Gruppen-Eskalation** sind implementiert, aber durch die Mockdaten nicht ausgelöst. Dafür gibt es keinen Test.
- **Eskalationsregel „größere Code-Änderung oder Code ohne Tests“**: nur über fehlgeschlagene simulierte Checks abgedeckt, nicht als eigene Regel.
- **Versions-Stand der Snapshots:** Es gibt nur den Snapshot `P0`. Die Phasen P1–P5 wurden in einem Durchgang gebaut, deshalb gibt es keine Zwischenstände.
- **Git-Hinweis:** Während des Baus habe ich einmal ein read-only `git status` im übergeordneten Repo ausgeführt. Es wurde nichts geändert.
- Die E2E-Tests laufen auf Windows mit `node` statt `pnpm` für den Webserver, weil der pnpm-Shim unter cmd.exe nicht startet.

## Wo die Ergebnisse liegen

- Code: `packages/*`, `apps/web`, `prisma/`, `scripts/`
- Mockdaten: `mockdata/` (über `node scripts/gen-mockdata.mjs` neu erzeugbar)
- Entscheidungen: `docs/decisions.md`
- Snapshot: `.snapshots/P0/` (ohne `.env`, ohne `node_modules`)
