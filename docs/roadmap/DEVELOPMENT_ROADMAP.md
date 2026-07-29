# Development Roadmap

> Sequenced plan from empty repository to AI Medical Engineer.
> Estimates assume **1–2 full-time developers** (see [OPEN_QUESTIONS](../OPEN_QUESTIONS.md) D-2).
> Durations are relative sizing, not commitments — they change the moment the blocking
> questions are answered.

## Ordering principle

Every phase must leave the product usable on its own, and each phase builds the substrate
the next one needs:

> geometry → objects → rules → validation → **AI** → documentation → twin

AI is deliberately late. An AI that proposes layouts before a validator exists produces
confident, unverifiable output — the worst possible result in a regulated domain.

---

## Phase 0 — Foundation (~1 week) — MFD-E v0.1 Alpha

Monorepo, TypeScript strict, lint, tests. Coordinate system and viewport maths as a pure
package. A canvas that pans, zooms, and shows a real millimetre grid.

**Done when:** a developer clones the repo, runs two commands, and gets a working canvas;
`pnpm test` and `pnpm build` pass.

**Delivers:** Sprint 1 in [MVP_PLAN.md](MVP_PLAN.md).

## Phase 1 — AI Dialysis Designer MVP (~6–9 weeks)

The seven must-haves from CLAUDE.md.

| Sprint | Delivers |
| --- | --- |
| 1 | Canvas foundation: grid, zoom/pan, toolbar, project structure |
| 2 | Document model, room boundary drawing, selection, undo/redo |
| 3 | Equipment library + drag and drop + object properties panel |
| 4 | Rule engine + clearance validation with live overlay |
| 5 | Backend, PostgreSQL, save/load project |
| 6 | Vector PDF export: drawing sheet, equipment schedule, validation report |

**Done when:** a facility engineer can lay out a dialysis unit, see clearance violations
with the clause each one breaks, save it, and export a PDF someone would accept.

**Blocked by:** OPEN_QUESTIONS A-1 through A-4 — without real standards and real equipment
dimensions, Sprints 3–4 have no data to run on.

## Phase 2 — AI Layout Assistance (~6–8 weeks)

`layout-engine` generates candidate arrangements under rule-engine constraints;
`ai-service` (Python FastAPI) provides the language interface — intent interpretation,
explanation of why a layout was chosen, draft documentation. `routing-engine` begins:
service connections (water, drain, power) between placements.

**Done when:** the user describes a unit in words ("28 stations, 2 isolation, stretcher
access on the north side") and receives ranked, rule-valid candidates, each with a written
rationale.

**Blocked by:** OPEN_QUESTIONS B-1 (data residency), B-2 (what "AI layout" means),
B-3 (optimisation objective).

## Phase 3 — Departments and Deliverables (~8–12 weeks)

Second and third department types (ICU, OR) — this is where the rule schema proves itself
or gets rewritten. DXF export. Floor plan import (DWG/DXF underlay). Multi-level projects.
Electron packaging if offline use is confirmed.

**Done when:** MFD-E output drops into an architect's drawing set without retyping.

## Phase 4 — Digital Twin (open-ended)

Three.js visualisation, as-built sync, equipment lifecycle and maintenance data, live
telemetry. Scope depends entirely on OPEN_QUESTIONS section C.

---

## Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Real standards never arrive | Fatal — the product becomes invented numbers | Ship Sprint 4 against a small, real, cited rule set even if it holds only five rules. Five cited rules beat fifty invented ones. |
| Rule schema too narrow for ICU/OR | Rewrite in Phase 3 | Test the schema against a second department's rules *on paper* during Phase 1, before freezing it. |
| Konva performance at scale | Canvas stutters on large plans | Perf budget from Sprint 1: layer separation, shape caching, viewport culling. Measure at 2,000 objects before Phase 3. |
| Scope creep into general CAD | Never ships | CLAUDE.md is explicit: MFD-E is not a CAD drawing tool. Every drawing feature must be justified by a dialysis-unit task. |
| AI expectations outrun the validator | Untrustworthy output | AD-10: the solver decides, the LLM explains. Hold this line. |
