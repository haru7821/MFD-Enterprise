# Sprint Plan — MFD-E TS Edition

> Plan of record. Governed by
> [MFD-E_TS_EDITION_SPEC.md](../product/MFD-E_TS_EDITION_SPEC.md).
> Sprint numbering fixed in Sprint 1.5.

| Sprint | Name | Spec section | Status |
| --- | --- | --- | --- |
| 1 | Foundation | 5.2 | ✅ **Complete** — v0.1 Alpha |
| 1.5 | Architecture stabilisation | — | ✅ Complete |
| 2 | Equipment Object System | 5.3 | ◀ **Next** |
| 3 | Rule Engine | 5.4 | ☐ |
| 4 | PDF Workflow | 5.1 | ☐ |
| 5 | Report Generation | 5.5 | ☐ |
| 6 | AI Assistant | §7 Version 3 | ☐ |

## Definition of done for the MVP (Sprints 1–5)

A Vantive TS engineer can import a hospital's floor plan, set its scale, place AK98 units
at true dimensions, see which installation requirements pass, need review or fail — **with
the manual section each result comes from** — and export a PDF installation review report.

Sprint 3 is the product. The rest is delivery mechanism.

---

## Sprint 1 — Foundation ✅

Delivered as v0.1 Alpha.

| Delivered | |
| --- | --- |
| Monorepo, TypeScript strict, Vitest, ESLint with an enforced package boundary | ✅ |
| `packages/cad-engine` — millimetre units, Vec2, Rect, viewport, adaptive grid | ✅ |
| Canvas with zoom, pan and a real millimetre grid | ✅ |
| Toolbar, status bar, scale bar | ✅ |

23 unit tests; typecheck, lint and build clean.

## Sprint 2 — Equipment Object System ◀ Next

Spec 5.3. Implements
[OBJECT_MODEL.md](../data-model/OBJECT_MODEL.md) and the Placement part of
[PROJECT_MODEL.md](../data-model/PROJECT_MODEL.md).

| Deliverable | Where |
| --- | --- |
| Equipment object schema and catalogue loader | `packages/object-library` |
| JSON equipment database, first record: Vantive AK98 | `packages/object-library/catalog/` |
| Object renderer — footprint, service clearance area, connection ports | `apps/web` |
| Dimension display | `apps/web` |
| Equipment palette, click-to-place, drag-to-move | `apps/web` |
| Undo / redo command stack | `apps/web` |

**Acceptance criteria**

- A malformed catalogue file is rejected with an error naming the file and the field.
- An AK98 placed on the canvas measures its catalogue width and depth at any zoom.
- Changing a value in the catalogue JSON changes what is drawn, with no code change.
- A record marked `verified` without document, revision and section fails to load.
- Draft data is visibly marked wherever it appears.
- 50 placed objects hold interactive frame rate (spec section 6).

**Not blocked** by the missing AK98 measurements: the record ships as `draft`, and the real
figures replace placeholders without touching code.

## Sprint 3 — Rule Engine

Spec 5.4. Where the product earns its purpose.

| Deliverable | |
| --- | --- |
| Rule record schema, rule set loader from `standards/rules/` | `packages/rule-engine` |
| Predicate evaluators: clearance, equipment collision, wall collision | |
| Connection availability and maintenance access checks | |
| GREEN / YELLOW / RED result model carrying the rule and its source | |
| Live violation overlay on the canvas, violation list panel | `apps/web` |
| `Space` and the space function vocabulary | |

**Acceptance criteria**

- Moving an AK98 too close to a wall raises a RED result naming the manual section it
  violates.
- Editing the rule JSON changes the outcome with no code change.
- **A result derived from draft data is never GREEN.**

**Blocked by:** the real clearance figures and the manual revision they come from. The
engine can be built and tested against fixtures; it cannot be seeded with anything true.

## Sprint 4 — PDF Workflow

Spec 5.1 and the "Scale Setting" item of 5.2. Floor plan **import**, not report output.

| Deliverable | |
| --- | --- |
| Import PDF, PNG and JPG as a raster underlay | |
| Two-point scale calibration | |
| `Level` and `PlanImage` in the document model | |
| Locked background layer beneath the design | |
| Project save / load with schema version and migration chain | |

**Acceptance criteria**

- A hospital PDF is imported, calibrated, and a 900 mm machine placed on it measures
  900 mm against the drawing's own dimension lines.
- An uncalibrated plan yields YELLOW with "plan not calibrated" — never GREEN.
- A project saved on one machine opens identically on another.

Scoped to raster underlay. Vector PDF geometry extraction, DXF and DWG stay in the
specification's "Future" list.

## Sprint 5 — Report Generation

Spec 5.5. PDF installation review report: project information, layout image, equipment
list, engineering check results, installation checklist.

Vector output, not a canvas screenshot — the geometry already lives outside the renderer
to make this possible (AD-2).

Every finding carries its rule and source; the report stamps the rule set version and the
equipment catalogue versions used.

**Done when:** the report is something a TS engineer would send to a hospital.

## Sprint 6 — AI Assistant

Specification section 7, Version 3. Intent interpretation, explanation of results, drafting
of report narrative. The solver and the validator decide; the assistant explains (AD-10).

**Blocked by:** whether project data may leave the hospital network — see
[OPEN_QUESTIONS](../OPEN_QUESTIONS.md) B-1.

---

## Note on ordering

Specification section 7 places routing and automatic layout in Version 2 and the AI
assistant in Version 3. The sprint sequence above reaches the AI assistant at Sprint 6,
ahead of routing. That is a deliberate sequencing choice by the product owner; the routing
and automatic-layout work is not cancelled, it is simply not yet scheduled. See
[DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md).

## Non-functional targets (spec section 6)

| Requirement | How it is met | Verified |
| --- | --- | --- |
| Support 50 equipment objects minimum | Flat scene graph, viewport culling | Sprint 2 |
| All engineering values come from the database | JSON catalogues and rule sets, versioned in git, loaded at runtime | Sprint 2–3 |
| Every rule requires source information | Enforced at load time; verified records without document, revision and section fail | Sprint 3 |
