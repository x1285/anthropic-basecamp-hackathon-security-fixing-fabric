# Specs

Die Akzeptanzkriterien pro Phase stehen im Konzept (`Bloodhound – Implementierungskonzept.md`, Abschnitt 4) und im Gate-Ergebnis (`docs/build-report.md`). Für jede Phase gibt es keine eigene Spec-Datei, weil die Phasen in einem Durchgang gebaut wurden.

Akzeptanzkriterien, überprüft durch die Tests:

- P1: Scan über main und deployte Releases (`packages/core/test/core.test.ts`, `packages/engine/test/pipeline.test.ts`)
- P1: SLA strengster Kunde und Floor ohne Kunden (`pipeline.test.ts`, `core.test.ts`)
- P2: Freigabe fächert auf alle Kunden der betroffenen Environments auf (`pipeline.test.ts`, E2E Schritt 4)
- P3: zwei verschiedene Fixes für sechs betroffene Repos (`pipeline.test.ts`, E2E Schritt 5)
- P4: grüne PRs, Eskalation am Versuchslimit (`pipeline.test.ts`, E2E Schritt 6 und 8)
- P5: verifizierter Abschluss, Rezept aus dem Gedächtnis (`pipeline.test.ts`, E2E Schritt 9)
