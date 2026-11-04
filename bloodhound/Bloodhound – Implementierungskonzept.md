# Bloodhound – Implementierungskonzept (vollautomatisch)

Stand: 4. Nov. 2026 · Basis: „Bloodhound – Concept & Architecture (First Draft)“

## 1. Ziel & Leitprinzipien

Claude-Agenten implementieren Bloodhound **vollständig ohne Menschen im Loop**: Sie planen, implementieren, testen, reviewen und mergen selbst und starten danach die nächste Phase. Der Mensch macht nur zwei Dinge:

1. Er startet den Orchestrator einmalig.
2. Am Ende liest er `docs/build-report.md`.

Leitprinzipien:

- **Inkrementell und lauffähig.** Jede Phase endet mit einem lauffähigen System, das gegen einen oder mehrere Demo-Schritte aus dem Konzeptdokument geprüft wird.
- **Grob getestet.**
  - Pro Modul gibt es Smoke- und Happy-Path-Tests.
  - Pro Demo-Schritt gibt es einen E2E-Smoke-Test.
  - Volle Testabdeckung ist ausdrücklich kein Ziel.
- **Nichts blockiert.** Offene Fragen und Annahmen werden als Config-Keys mit Defaults umgesetzt, die der Agent selbst wählt (Abschnitt 5). Fehler führen zu Self-Healing oder Feature-Flags, nie zu einer Wartezeit auf einen Menschen.
- **Nur lokal, ohne Git und ohne GitHub.**
  - Es gibt weder Branches noch Commits, PRs oder eine Remote-CI.
  - Alles läuft im lokalen Dateisystem und gegen Postgres in Docker.
  - Projekte, Repos, Environments, Kunden und Incidents sind **Mockdaten**.
  - Ein „PR“ ist ein simulierter Datensatz, der den Diff und das Testergebnis enthält.
- **Bauprozess und Produkt sind getrennt.** Die Approval-Inbox für Kundentexte und „Bloodhound merged/deployt nicht selbst“ sind *Produkt-Features* aus dem Konzept. Sie werden gebaut, und in den automatischen Tests bedient ein **simulierter Approver** die Inbox. Für den Bauprozess selbst gelten diese Regeln nicht.

## 2. Zielarchitektur

```
bloodhound/
├─ apps/web            Next.js: Dashboard, Approval-Inbox, Outbox, Demo-Lab, API-Routen (Webhook)
├─ packages/core       Domänenmodell, Scan (semver), SLA-Engine, Priorisierung – deterministisch
├─ packages/agent      Claude Agent SDK: Gruppierung, Rezepte, Kundentexte, Fix-Läufe
├─ packages/sandbox    Mock-Repo kopieren → Rezept anwenden → Build/Test simulieren → Re-Scan → simulierter PR
├─ packages/adapters   Interfaces + Fakes: Mail (Outbox), Paging, Tickets, Deploy-Quelle, Code-Host (lokal)
├─ mockdata/           Projekte, Repos (inkl. Dateibäume), Environments, Kunden, Incident-Katalog
├─ prisma/             Schema, Migrationen, Seed (liest mockdata/)
├─ specs/phase-N.md    Akzeptanzkriterien je Phase (Input für die Agenten)
├─ .snapshots/         Kopie des Stands nach jeder grünen Phase (Ersatz für Git)
├─ docs/               decisions.md, build-report.md
├─ .env                ANTHROPIC_API_KEY, DATABASE_URL (vom User bereitgestellt, nicht anfassen)
└─ docker-compose.yml  Postgres
```

### Mockdaten

| Datei | Inhalt |
|---|---|
| `mockdata/projects.json` | 4 Projekte mit Owner-Team, je 3 Environments (dev, staging, prod) mit Regeln (Slack-Channel, SLA-Floor) und deploytem Release |
| `mockdata/customers.json` | 12 Kunden mit Vertragsstufe, SLA pro Severity, Kontakten, Opt-in für „nicht betroffen“ und zugeordneten Environments |
| `mockdata/repos/<name>/` | ca. 10 Mini-Repos als echte Dateibäume: `package.json` und Lockfile in verschiedenen Ökosystemen und Versionen, ein paar Quelldateien und `bloodhound.test.json` (siehe unten) |
| `mockdata/releases.json` | Pro Environment der deployte Release mit Lockfile-Stand. Dieser kann von `main` abweichen, damit der environment-aware Scan etwas zu tun hat. |
| `mockdata/incidents/*.json` | OSV-Payloads, z. B. `jsonwebtoken < 9.0.0` (kritisch), `lodash < 4.17.21`, ein zweiter jsonwebtoken-Fall für die Memory-Wiederverwendung und ein Fall ohne Fix-Version (Eskalation) |

Die Mockdaten sind so verteilt, dass die Demo herauskommt: 6 betroffene Repos über prod und staging, 2 unterschiedliche Fixes und 1 Repo, das am Versuchslimit scheitert.

**Simulierter Build/Test:**
- Echtes `npm install` oder ein echter Build ist nicht nötig, das Ganze funktioniert offline.
- Jedes Mock-Repo beschreibt in `bloodhound.test.json` deterministische Regeln, zum Beispiel:
  - „Test grün, wenn `jsonwebtoken >= 9.0.0` und `verify()` mit `algorithms` aufgerufen wird“
  - „bricht bei Major-Upgrade von X ohne Code-Anpassung Y“
- Der Test-Runner in `packages/sandbox` wertet diese Regeln gegen den veränderten Dateibaum aus.

**Simulierter PR:**
- Die Sandbox kopiert das Mock-Repo in ein Arbeitsverzeichnis (`.work/<run>/<repo>/`) und wendet das Rezept an.
- Der Diff wird berechnet und zusammen mit dem Testergebnis als `PullRequest`-Datensatz gespeichert.
- Das Dashboard zeigt den PR wie einen echten an, mit Diff, Checks und Status „open“.
- Ein „Merge & Deploy“-Button im Demo-Lab schreibt den neuen Lockfile-Stand in den Release des Environments. Danach folgt der Re-Scan.

- **Stack:**
  - TypeScript, pnpm-Monorepo und Next.js (App Router).
  - Claude Agent SDK mit dem Modell `claude-opus-5-5` für Gruppierung, Rezepte und Fixes und `claude-haiku-5-5` für Kundentext-Personalisierung.
  - Vitest und Playwright für Tests.
- **Datenbank:** Prisma auf **Postgres 16 im Docker-Container**, und zwar ab P0.
  - `docker-compose.yml` definiert den Service `postgres:16` mit Healthcheck.
  - Der Orchestrator startet ihn mit `docker compose up -d --wait`.
  - Migrationen laufen mit `prisma migrate deploy`.
  - Das lokale Gate nutzt eine eigene Test-Datenbank im selben Container (`bloodhound_test`).
- **Entitäten:** Sie werden 1:1 aus „Domain model“ übernommen: Project, Repo, Environment, Customer, Incident, Group und Recipe. Dazu kommen:
  - `Run` (ein Lauf pro Incident),
  - `Message` (Entwurf, Freigabe, Outbox),
  - `FixAttempt`,
  - `Escalation`,
  - `RecipeVersion` (Memory-Store mit Learnings-Log).
- **Adapter-Prinzip:** Jede externe Abhängigkeit liegt hinter einem Interface, für das es eine Fake-Implementierung gibt, auch der Code-Host. In diesem Bau laufen **ausschließlich Fakes**. Echte Anbindungen wie GitHub oder E-Mail sind später reine Adapter-Implementierungen, ohne Änderung an der Kernlogik.
- Ein `PullRequest` ist zusätzlich eine eigene Entität. Sie enthält das Repo, den Diff, Checks, den Status und das Rezept in seiner jeweiligen Version.

## 3. Automatisierungs-Pipeline (wie Claude baut)

### 3.1 Orchestrator

Ein lokaler Claude-Code-Workflow arbeitet die Phasen P0 bis P7 nacheinander ab. Pro Phase läuft diese Schleife:

```
Spec lesen ─► Plan-Agent: Task-Liste + Modulzuschnitt + Entscheidungen (→ docs/decisions.md)
          ─► Implementierungs-Agenten parallel, jeder nur in seinem eigenen Paketordner
             (disjunkte Verzeichnisse statt Git-Worktrees, inkl. Smoke-Tests)
          ─► Integrations-Agent: Schnittstellen verdrahten (apps/web, gemeinsame Typen)
          ─► Review-Agent: Review der geänderten Dateien + Fixes
          ─► Lokales Gate `pnpm gate`: typecheck · lint · vitest · playwright (Demo-Schritt der Phase)
          ─► grün?  ja ─► Snapshot nach .snapshots/phase-N/, Eintrag im Report, nächste Phase
                    nein ─► Self-Healing (3.2)
```

Ohne Git dienen Snapshots als Sicherungspunkte:
- Nach jeder grünen Phase kopiert der Orchestrator den Code nach `.snapshots/phase-N/`. Ausgenommen sind `node_modules`, `.work` und `.snapshots`.
- Läuft eine Phase völlig aus dem Ruder, stellt der Orchestrator den letzten Snapshot wieder her und beginnt die Phase mit verkleinertem Scope neu.

### 3.2 Self-Healing statt Eskalation

1. **Reparieren.** Ein Fix-Agent liest die Gate-Logs, repariert und lässt das Gate erneut laufen. Das passiert höchstens 3 Runden lang.
2. **Scope verkleinern.** Ist das Gate danach immer noch rot, kommt das betroffene Feature hinter ein Feature-Flag (`flags.<feature>=false`). Der zugehörige E2E-Test wird als `skip` mit Verweis markiert und als offener Punkt in den Report eingetragen. Danach läuft der Bau weiter.
3. **Harter Abbruch.** Er passiert nur, wenn der deterministische Kern nicht grün wird, also Schema, Scan oder SLA-Engine. Alle späteren Phasen hängen davon ab. Auch dann schreibt der Orchestrator den Report.

### 3.3 Grobes Testen

| Ebene | Was | Umfang |
|---|---|---|
| Unit-Smoke | Ein bis drei Tests pro Modul, Happy Path. Bei Scan und SLA zusätzlich die Grenzfälle aus dem Konzept (Env ohne Kunden → Floor, unpinned Version) | schnell, bei jedem Commit |
| LLM-Fixtures | Agent-Aufrufe gegen aufgezeichnete Antworten (Record/Replay) | deterministisch im Gate |
| Live-Smoke | Pro Phase ein Incident einmal gegen das echte Modell. Geprüft werden nur Struktur und Schema, nicht der Inhalt | ein Lauf pro Phase |
| E2E | Playwright durchläuft den Demo-Schritt der Phase im Dashboard und bedient dabei auch den simulierten Approver | ein Szenario pro Gate |

### 3.4 Voraussetzungen (einmalig vor dem Start)

- Docker läuft lokal, und Node 22 mit pnpm ist installiert.
- `bloodhound/.env` mit `ANTHROPIC_API_KEY`, bereitgestellt vom User.
  - Die Agenten lesen die Datei nur, ändern sie nie und geben sie nie aus.
  - `DATABASE_URL` ergänzt der Orchestrator in einer separaten `.env.local`.
- Eine Permission-Allowlist für `pnpm`, `node`, `npx prisma`, `npx playwright` und `docker compose`, damit der Lauf ohne Prompts durchläuft. Git und GitHub werden nicht verwendet.
- Fix-Ziele sind ausschließlich die Mock-Repos unter `mockdata/repos/`. Diese erzeugt der Orchestrator in P0 selbst.

### 3.5 Artefakte

- `CLAUDE.md` des Code-Repos: Befehle, Konventionen, Invarianten und das Adapter-Prinzip.
- `specs/phase-N.md`: Akzeptanzkriterien, die aus den Abschnitten 4 und 5 dieses Dokuments abgeleitet sind.
- `docs/decisions.md`: jede Entscheidung des Agenten mit Begründung.
- `docs/build-report.md`: Status pro Phase, deaktivierte Flags, Entscheidungen, Kosten und das Ergebnis des vollständigen Demo-Laufs (Schritte 1–9).

## 4. Umsetzungsreihenfolge (MVP → final)

| Phase | Inhalt | Gate |
|---|---|---|
| **P0 Fundament** | Monorepo, lokales Gate-Skript, Postgres per Docker Compose, Prisma-Schema und Migrationen, komplette Mockdaten (Projekte, Environments, 12 Kunden, Mock-Repos mit Dateibäumen, Releases, Incident-Katalog) und Seed, Adapter-Interfaces mit Fakes, `CLAUDE.md`, Spec-Templates | Gate grün, Seed lädt, Dashboard-Shell startet |
| **P1 MVP „Walking Skeleton“** | Onboarding (Mock-Repos und eingefügte Manifeste/Lockfiles → Dependencies und Fingerprint; deployter Release pro Environment), lokaler Webhook (`POST /api/incidents`) für OSV-Payloads und Demo-Lab, das Incidents aus `mockdata/incidents/` abfeuert oder frei editierbare erstellt, environment-aware Scan (Range gegen main und jede deployte Version, unpinned-Flag), SLA-Engine (strengster Kunde, Env-Floor, Uhr ab Detection), Dashboard mit Runs und SLA-Countdowns | Demo 1–3 |
| **P2 Kommunikation** | Claude entwirft einen Kundentext pro Incident, Approval-Inbox, Fan-out personalisierter Kopien an alle Kunden betroffener Environments in die Outbox, sichtbarer Approval-Timer (10 % des SLA, Backup-Approver nur angezeigt), Auflösungsnachricht nach dem Fix | Demo 4 |
| **P3 Gruppierung & Rezepte** | Deterministische Fix-Signatur-Hints, LLM-Gruppierung mit Begründung und Confidence, ein Rezept pro Gruppe (Strategie, Schritte, Breaking Changes, Verifikationsplan, S/M/L, Confidence), Memory-Store mit Versionierung, Priorisierung (Gruppen nach Deadline, dann Kunden; Repos nach Deadline, Komplexität, Kunden) | Demo 5 („X Repos, Y Fixes“) |
| **P4 Pilot-Fixing** | Pilotwahl (sicherstes repräsentatives Repo, das dringende nur bei zu engem SLA), lokale Sandbox (Mock-Repo nach `.work/` kopieren → Claude wendet das Rezept an → simulierter Build/Test → Re-Scan → simulierter PR), Limits 3 Versuche / 30 min pro Repo, Rezept-Update und Learnings nach jedem Repo, Neuberechnung der Priorität | Demo 6–7 (simulierter PR mit grünen Checks) |
| **P5 Abschluss & Lernen** | Eskalation (Regeln aus „Assumed for escalation“, Ticket-Entwurf mit Versuchen, Logs, Rezept-Stand und Checkliste der manuellen Schritte), SLA-Alarm bei 50 %, Verified Closure (simulierter Deploy-Button → Re-Scan des deployten Releases), Rezept-Wiederverwendung aus dem Memory beim nächsten gleichartigen Incident, At-Risk-Flagging hinter einem Flag | Demo 8–9 → **Hackathon-Demo komplett** |
| **P6 Produktionsreife (lokal)** | Approver-Rollen und einfacher lokaler Login; Audit-Log aller Freigaben und Agent-Aktionen; Pseudonymisierung (an das Modell gehen keine Kundenkontakte); Adapter-Verträge für echte Systeme (Code-Host, E-Mail, Slack/Paging, Tickets, Deploy-Quelle) als Interfaces mit Contract-Tests gegen die Fakes. Echte Anbindungen sind *nicht* Teil dieses Baus. | Contract-Tests grün, Audit-Log vollständig im E2E |
| **P7 Final v1** | Defaults aus Abschnitt 5 verbindlich machen; Mehrsprachigkeit und Templates pro Kunde; gemeinsamer Fix/Deploy für Multi-Repo-Projekte; Observability (Traces pro Run, Kosten pro Incident); SLA-Reporting; Last- und Ausfall-Smoke (10 parallele Incidents, Neustart mitten im Run) | v1-Ziele messbar: Closure im SLA, Kennzahl „X/Y“, keine Nachricht ohne Freigabe, jedes Repo *fixed* oder *escalated* |

**Begründung der Reihenfolge:**

1. **Deterministischer Kern zuerst.** Scan und SLA kommen in P1 vor allem anderen, weil alle späteren Phasen ihre Daten nutzen.
2. **Danach die LLM-Teile ohne schreibende Wirkung.** Kommunikation (P2) und Gruppierung (P3) lassen sich gut mit Fixtures testen.
3. **Erst dann schreibende Aktionen in Fremd-Repos.** Fixing und PRs (P4) haben das höchste Risiko und die längste Laufzeit.
4. **Lernen und Closure brauchen echte Fix-Läufe.** P5 baut auf den Ergebnissen von P4 auf.
5. **Produktionsreife zuletzt.** P6/P7 härten das System und definieren Adapter-Verträge, ändern aber keine Kernlogik. Echte Systeme lassen sich später ohne Umbau anschließen.

Mit dem Ende von P5 ist die Hackathon-Demo vollständig. P6 und P7 sind der Weg zur finalen Version.

### Feature-Abdeckung (Checkliste)

| Feature aus „Features for v1“ | Phase |
|---|---|
| Onboarding | P0 (Seed) / P1 |
| Incident intake | P1 |
| Environment-aware scan | P1 |
| SLA engine | P1 (Grundlogik), P5 (Alarm) |
| Customer notification | P2 |
| Approval escalation | P2 (Timer), P6 (echter Ping) |
| LLM grouping | P3 |
| At-risk flagging | P5 (optional, Flag) |
| Fix recipes | P3 |
| Prioritisation | P3 (Ranking), P4 (Neuberechnung) |
| Pilot run | P4 |
| Sandboxed fixing | P4 |
| Learning recipes | P4 |
| Verified closure | P5 |
| Escalation | P5 |
| Dashboard | P1, danach in jeder Phase erweitert |

## 5. Annahmen & offene Fragen → Config-Defaults

Der Plan-Agent setzt diese Defaults und protokolliert sie in `docs/decisions.md`. P7 macht sie verbindlich. Keine Entscheidung wartet auf einen Menschen.

| Frage / Annahme | Config-Key | Default |
|---|---|---|
| Wer gibt Kundentexte frei? | `approval.approverSource` | `projectOwner`; Backup ist die On-Call-Person |
| Woher kommt die Laufzeitversion pro Environment? | `deploy.versionSource` | `mockReleases` (aus `mockdata/releases.json`); `releaseTagLockfile` und `sbom` nur als Interface |
| Multi-Repo-Projekte gemeinsam fixen/deployen? | `fix.projectAtomic` | `false`, ab P7 pro Projekt konfigurierbar |
| Sprache und Templates der Kundentexte | `notify.locale`, `notify.templatePerCustomer` | `de` mit Fallback `en`, `false` |
| Welche Kundendaten dürfen in die Cloud? | `privacy.sendCustomerPII` | `false`, das Modell bekommt nur pseudonymisierte IDs |
| Code-Änderungen in Rezepten erlaubt? | `recipe.allowCodeChanges` | `false` bis P4 (nur Dependencies), danach `true` für Komplexität S |
| Repo-Eskalation | `escalation.repo.*` | Limit von 3 Versuchen / 30 min, kein Fix-Release, größere Code-Änderung oder Code ohne Tests |
| Gruppen-Eskalation | `escalation.group.pilotFailures` | `2` (inkl. einer Rezept-Revision) |
| SLA-Alarm | `sla.alarmAt` | `0.5` ohne getesteten PR |
| Approval-Ping | `approval.escalateAt` | `0.1` des SLA |

## 6. Risiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| LLM-Gruppierung ist nicht deterministisch, Tests flackern | Record/Replay-Fixtures im Gate; der Live-Smoke prüft nur das Schema |
| Fix-Agent schreibt außerhalb seines Arbeitsverzeichnisses | Sandbox arbeitet nur in `.work/<run>/<repo>/`, Mock-Repos in `mockdata/` sind schreibgeschützt; Build/Test wird simuliert, es wird kein fremder Code ausgeführt |
| Ohne Git geht Arbeit verloren | Snapshot nach jeder grünen Phase, Wiederherstellung durch den Orchestrator |
| Mockdaten sind zu „glatt“ und die Demo zu trivial | Der Mock-Katalog enthält bewusst Abweichungen: deployter Release ≠ main, unpinned Versionen, Env ohne Kunden, Fall ohne Fix-Version, Repo mit Breaking Change |
| Self-Healing verdeckt Fehler | Jedes deaktivierte Flag und jeder übersprungene Test steht im Build-Report |
| Kosten der Agent-Läufe | Haiku für einfache Schritte, Budget-Limit pro Phase im Orchestrator, Kosten im Report |
| Scope-Creep in P6/P7 | Echte Integrationen nur hinter vorhandenen Interfaces; neue Features nur aus „Features for v1“ |
