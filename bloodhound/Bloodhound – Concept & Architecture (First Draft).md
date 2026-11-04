# Bloodhound – Concept & Architecture (First Draft)

Nov 4, 2026 · @Till Möller

## Summary

Bloodhound is an always-on agent that turns an incoming security incident into verified fixes across every affected project and environment. It tells customers what is happening, and a human approves every customer-facing text. It groups repos that need the same change, so a fix is worked out once per group instead of once per repo, and each fix gets better with every repo it is applied to.

Goals for v1:

- Every affected environment is verified as fixed within the strictest SLA of the customers on it.
- The headline per incident is "X affected repos, Y distinct fixes", not X separate fixes.
- No message reaches a customer without human approval of its text.
- Every affected repo ends in one of two states: verified fixed, or escalated with the manual steps that remain.

## Domain model

Customers attach to environments, not to projects: one environment serves n customers, and a customer can use several environments.

| Entity | Holds | Relations |
| --- | --- | --- |
| Project | Name, owning team | Has n repos and n environments |
| Repo | Dependencies from the lockfile, tech fingerprint (ecosystem, frameworks, major versions, base image) | Belongs to a project |
| Environment | Pipeline position, deployed release and the versions it runs, rules (paging, Slack channel, internal SLA floor) | Belongs to a project, serves n customers |
| Customer | Contract tier, SLA per severity, contacts, opt-in for "not affected" notices | Uses n environments |
| Incident | OSV-style payload: package, ecosystem, affected range, severity | Produces one run |
| Group | Repos that need the same fix, with the LLM's rationale and confidence | Has one recipe |
| Recipe | Strategy, steps, breaking-change notes, verification plan, complexity (S/M/L), confidence, learnings log | Belongs to a group, stored in memory |

SLA rules:

- The SLA comes from the customer contract, per severity.
- An environment's effective SLA is the strictest SLA among its customers. Environment rules act as the floor for environments with no customers.
- The clock starts when the incident is detected. Time spent waiting for approval counts and is shown.

## Features for v1

V1 covers the whole workflow, but Bloodhound never merges or deploys by itself: it stops at a tested PR or a prepared deploy request.

| Feature | What it does | Step | Hackathon |
| --- | --- | --- | --- |
| Onboarding | Register projects, repos, environments and customers; read lockfiles; record each environment's deployed release and versions | Setup | Fake repos and pasted manifests (built) |
| Incident intake | Receive OSV-style payloads through a webhook; demo lab to create fake incidents | 1 | Built |
| Environment-aware scan | Match the affected range against main and every deployed environment; flag unpinned versions for a manual check | 2 | Built |
| SLA engine | Strictest customer SLA per environment, environment floor, clock from detection | 2, 6 | Partly built (SLA per environment) |
| Customer notification | Draft one text per incident; a human approves it; fan out personalised copies to every customer on affected environments; resolution notice after the fix | 3 | Outbox instead of real email |
| Approval escalation | Ping a backup approver when approval waits longer than 10% of the SLA | 3 | Timer shown only |
| LLM grouping | Group repos by project context, with deterministic fix-signature hints, a rationale and a confidence per group | 4 | Yes |
| At-risk flagging | Flag unaffected repos with the same fingerprint, for example one minor version away | 4 | Optional |
| Fix recipes | One recipe per group: strategy, steps, breaking changes, verification plan, complexity, confidence | 5 | Yes |
| Prioritisation | Rank groups by tightest deadline, then customers; rank repos by deadline, complexity, customers; recalculate after every repo | 6 | Yes |
| Pilot run | Try each recipe on the safest representative repo first; the urgent repo is the pilot only if the deadline is too tight | 7 | Yes |
| Sandboxed fixing | Clone, apply the recipe, build, test, re-scan, open a PR; at most 3 attempts or 30 minutes per repo | 7 | Against a synthetic repo |
| Learning recipes | Update the recipe after every repo; keep a learnings log in memory | 7 | Yes |
| Verified closure | Repo counts as fixed only when the deployed release in each affected environment is re-scanned as safe | 7 | Simulated deploy |
| Escalation | Hand off with attempts, logs and the remaining manual steps | 8 | Ticket draft |
| Dashboard | Incident runs, groups, priorities, approvals, SLA countdowns | All | Extend the current UI |

## Hackathon scope and demo

The demo shows one incident going end to end, from webhook to verified fix, with a real PR on a synthetic repo and everything customer-facing kept in an outbox.

Real for the demo: the Routine, the webhook, LLM grouping, recipe drafting, the pilot fix with a real PR on a synthetic GitHub repo, and the memory store. Mocked: customer email (outbox), paging, deployments (a button marks a release as deployed) and the customer list.

Demo script:

1. Show the dashboard: 4 projects, 3 environments each, 12 customers.
2. Fire a critical incident from the lab, for example `jsonwebtoken < 9.0.0`.
3. The scan shows 6 affected repos across prod and staging, with SLA countdowns.
4. The approval inbox shows one customer text; approve it and the outbox fills with 12 personalised copies.
5. Grouping shows "6 affected repos, 2 distinct fixes" with the rationale per group.
6. The priority list puts the pilot first; the pilot opens a real PR with green tests.
7. The recipe updates with a learning, and the next repo uses the updated recipe.
8. One repo hits the attempt limit and is escalated with its manual steps.
9. Fire a second incident of the same kind: the recipe comes back from memory, so grouping and fixing start immediately.

## Open questions and assumptions

Step 8 was not discussed in detail, so its rules below are assumptions to confirm.

Assumed for escalation (step 8):

- A repo is escalated when it hits the attempt or time limit, when no fixed version exists, or when the fix needs larger code changes or touches code without tests.
- A group is escalated when its pilot fails twice, including after one recipe revision.
- An SLA alarm fires when half the SLA has passed without a tested PR.
- An escalation creates a ticket for the project owner with the attempts, logs, the recipe so far and a checklist of manual steps. Manual steps that remain after an automated fix are listed on the run and in the PR.

Open questions:

- [ ] Who approves customer texts: a fixed role per project, or whoever is on call?
- [ ] How do we learn what each environment runs: release tags plus lockfiles, or an SBOM published by CI per deployment?
- [ ] Do projects with several repos need to be fixed and deployed together?
- [ ] Which language are customer texts written in, and is there a template per customer?
- [ ] Which customer data may be stored in the Anthropic cloud, and what stays in our systems?
- [ ] Are code changes allowed in recipes for v1, or dependency changes only?
