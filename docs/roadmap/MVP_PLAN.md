# MVP Plan — Phase 1: AI Dialysis Designer

> Scope and acceptance criteria for the seven must-haves in CLAUDE.md.

## Definition of done for the MVP

A hospital facility engineer can:

1. Open MFD-E and define a dialysis unit boundary at real dimensions.
2. Drag real dialysis equipment onto the plan from a catalogue.
3. Edit an object's properties and see its required clearance envelope.
4. See, live, which clearances are violated — **and read the clause each violation breaks**.
5. Save the project and reopen it exactly as left.
6. Export a PDF containing the drawing, an equipment schedule, and a validation report
   stamped with the rule set version used.

Point 4 is the product. Everything else is delivery mechanism.

---

## Sprint 1 — Canvas Foundation (v0.1 Alpha) ✅

**Scope, per the product owner's instruction:** frontend setup, canvas engine foundation,
grid system, zoom/pan, basic toolbar, project folder structure. No AI, no 3D, no BIM.

| # | Deliverable | Acceptance criterion |
| --- | --- | --- |
| 1.1 | pnpm monorepo, TS strict, lint, tests | `pnpm install && pnpm test && pnpm build` pass from a clean clone |
| 1.2 | `packages/cad-engine` — units, Vec2, viewport | Pure TypeScript, zero UI imports, unit-tested |
| 1.3 | Grid system | Adaptive millimetre grid; spacing relabels as you zoom; major/minor lines |
| 1.4 | Zoom / pan | Wheel zooms at the cursor; drag or space-drag pans; zoom range 1 %–3200 % |
| 1.5 | Toolbar | Tool selection with keyboard shortcuts; state held outside the canvas |
| 1.6 | Status bar | Live cursor position in millimetres and current zoom |

**Explicitly out of scope for Sprint 1:** drawing shapes, equipment, saving, validation.

## Sprint 2 — Document Model and Drawing

Document schema v1 (`Project → Level → Space → Placement`), command-stack undo/redo,
room boundary tool, selection and transform, snapping to grid and to geometry.

**Done when:** a user draws a room at 8,400 × 12,600 mm, undoes and redoes every step, and
the document serialises to JSON and back identically.

## Sprint 3 — Equipment Library

Equipment definition schema (footprint, clearance envelope, service ports, parameters),
catalogue loader, library panel, drag and drop onto the canvas, properties inspector.

**Done when:** a real dialysis machine and treatment chair can be placed at true dimensions
with their manufacturer service clearances shown.

**Blocked by:** OPEN_QUESTIONS A-4 — real equipment dimensions.

## Sprint 4 — Rule Engine and Clearance Validation

Rule record schema (AD-5), rule-set loader from `standards/rules/`, predicate evaluators
starting with `clearance`, violation model carrying `severity` + `citation`, live overlay
on the canvas, violation list panel.

**Done when:** moving a chair 100 mm too close to a wall raises a violation naming the
clause, and changing the rule JSON changes the result with no code change. That last
clause is the test of CLAUDE.md's core principle.

**Blocked by:** OPEN_QUESTIONS A-1, A-3 — the governing standard and its real values.

## Sprint 5 — Persistence

NestJS API, PostgreSQL schema, project CRUD, document versioning and migration chain,
server-side authoritative re-validation on save, authentication.

**Done when:** a project saved on one machine opens identically on another, and the server
independently confirms the client's validation result.

**Blocked by:** OPEN_QUESTIONS A-7 — deployment and tenancy model.

## Sprint 6 — Report Export

`report-engine`: vector PDF (not a screenshot) with a titled drawing sheet at a stated
scale, an equipment schedule table, and a validation report listing every finding with its
clause and the rule set version.

**Done when:** the PDF is something a facility engineer would attach to a submission.

**Blocked by:** OPEN_QUESTIONS A-6 — whether PDF alone is an accepted deliverable.

---

## What would make this plan wrong

If the answer to OPEN_QUESTIONS A-2 is "users import an existing architectural DWG," then
Sprint 2 grows by several weeks and a DWG/DXF parser enters Phase 1. That single answer is
the largest uncertainty in this plan.
