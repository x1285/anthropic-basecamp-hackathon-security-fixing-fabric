# Entscheidungen des Bauprozesses

Jede Entscheidung, die nicht im Konzept festgelegt war, steht hier mit Begründung.

| # | Entscheidung | Begründung |
|---|---|---|
| D1 | Kein Git, kein GitHub. Sicherungspunkte sind Snapshots in `.snapshots/<phase>/`. | Vorgabe des Users. |
| D2 | Postgres 16 in Docker Compose ab P0. Prisma 6 mit Migrationen. Test-DB `bloodhound_test` im selben Container. | Vorgabe des Users (Docker-Postgres erlaubt). Prisma 6 statt 7, weil die Konfiguration stabil ist. |
| D3 | `DATABASE_URL` steht in `.env.local` (vom Orchestrator geschrieben), `ANTHROPIC_API_KEY` in `.env` (vom User). Die Dateien werden per `dotenv-cli` bzw. `process.loadEnvFile` geladen, nie ausgegeben und nie in Snapshots kopiert. | Konzept Abschnitt 3.4. |
| D4 | Ein eigenes Paket `packages/engine` (nicht im Konzept genannt). Hier liegt die Pipeline mit Prisma. `core` bleibt rein und ohne Datenbank. | Trennung: `core` ist ohne I/O testbar, die Engine enthält die Orchestrierung. |
| D5 | LLM-Aufrufe über die Messages-API (`@anthropic-ai/sdk`), nicht über das Claude Agent SDK. | Die Aufgaben sind einzelne strukturierte Aufrufe ohne Tool-Schleife. Das Agent SDK braucht man dafür nicht. |
| D6 | Ausschließlich `claude-haiku-5-5` für alle Aufgaben. `callJson` verweigert jedes andere Modell. | Vorgabe des Users. Die ursprünglich geplante Opus-Nutzung für Gruppierung und Rezepte entfällt. |
| D7 | Drei LLM-Modi über `BLOODHOUND_LLM`: `live` (ruft an und schreibt Fixtures nach `fixtures/llm/`), `replay` (Default, nur Fixtures), `off`. Fehlt ein Fixture, greift eine deterministische Vorlage. | Lauf bleibt offline und deterministisch. Die Vorlage ist im Report sichtbar gekennzeichnet. |
| D8 | Personalisierung der Kundentexte erfolgt lokal über Vorlage, nicht über Haiku. | `privacy.sendCustomerPII=false`. Mit der Vorlage geht kein Kundenname an das Modell. |
| D9 | Die Freigabe eines Kundentextes wartet als Produkt-Feature in der Inbox. Die Tests bedienen sie über einen simulierten Approver (Playwright-Klick). Der Bauprozess selbst hat keine menschlichen Schritte. | Konzept Abschnitt 1, Produkt-Features bleiben erhalten. |
| D10 | Gruppierung ist deterministisch über die Signatur `paket|zielversion|strategie` (direct / transitive). Das LLM liefert nur die Begründung. | Konzept Abschnitt 4 (P3, Signatur-Hints). Ergebnis ist reproduzierbar. |
| D11 | Rezept-Gedächtnis: ein Rezept pro Signatur, über alle Runs geteilt. Gleichzeitige Anlage ist über die Unique-Constraint abgesichert. | Konzept Domänenmodell (Recipe "stored in memory"). |
| D12 | Simulierter Build/Test: deterministische Regeln in `bloodhound.test.json` (`greenWhen`, `codeChecks`). Kein fremder Code wird ausgeführt. | Konzept Abschnitt 2 (simulierter Build). Verhindert Ausführung von Fremdcode. |
| D13 | Der simulierte PR ist ein `PullRequest`-Datensatz mit Diff und Checks. Merge & Deploy aktualisiert Lockfile-Stand auf main und im Environment und startet den Re-Scan. | Konzept Abschnitt 2 (simulierter PR). |
| D14 | Alle Config-Defaults aus Konzept Abschnitt 5 stehen als Konstanten in `pipeline.CONFIG`. Nur `recipe.allowCodeChanges` (default aus) und `feature.atRiskFlagging` (default aus) liegen als Flags in der DB. | Einfach und nachvollziehbar. |
| D15 | Ein Repo gilt erst als *fixed*, wenn nach Merge & Deploy der Re-Scan der betroffenen Environments sauber ist. | Konzept Domänenmodell (verifizierter Abschluss). |
| D16 | Pilot: das Repo mit dem niedrigsten Komplexitätsgrad und vorhandenen Tests. Ist die Frist unter 12 h, pilotiert das dringendste Repo. Schlägt der Pilot fehl, wird das Rezept einmal überarbeitet und der Pilot neu gestartet. Der zweite Fehlschlag eskaliert die Gruppe. | Konzept Abschnitt 5 (Gruppen-Eskalation nach zwei Fehlern inkl. einer Revision). |
| D17 | Kundenmitteilung und Auflösung laufen über dieselbe Inbox. Die Fan-out-Kopien gehen an alle Kunden der betroffenen Environments. Im Mock-Katalog sind das 10 Kunden für INC-1 (nicht 12, wie im Konzept-Demo-Skript grob angenommen). | Ergibt sich aus den Mockdaten. |
| D18 | Der Mock-Katalog ist absichtlich unordentlich: deployter Release weicht von main ab (portal-auth, logistics-notify), ungepinnte Version (shop-web), Environment ohne Kunden (billing-staging), Fall ohne Fix-Version (pdf-parse-lite), Repo mit Breaking Change (legacy-cms). | Konzept Abschnitt 6 (Mockdaten zu glatt). |
| D19 | Der Gate-Lauf ersetzt die CI. Er läuft in dieser Reihenfolge: Docker-Postgres, Migrationen (dev und test), Typecheck, Vitest, Web-Build, Playwright-E2E. Grün heißt: Snapshot nach `.snapshots/<phase>/`. | Konzept Abschnitt 3.1. |
| D20 | Eine Phase pro Snapshot wurde nicht gebaut. Alle Phasen P0–P5 entstanden in einem Durchgang, danach ein Gate-Lauf mit Snapshot `P0`. | Ehrlich gekennzeichnet, siehe `docs/build-report.md`. |
