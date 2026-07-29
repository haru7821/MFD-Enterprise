# Sprint Plan — MFD-E TS Edition

> Plan of record. Governed by
> [MFD-E_TS_EDITION_SPEC.md](../product/MFD-E_TS_EDITION_SPEC.md).
> Sprint numbering fixed in Sprint 1.5.

| Sprint | Name | Spec section | Status |
| --- | --- | --- | --- |
| 1 | Foundation | 5.2 | ✅ **Complete** — v0.1 Alpha |
| 1.5 | Architecture stabilisation | — | ✅ Complete |
| 2 | Equipment Object System | 5.3 | ✅ **Complete** — v0.2 Alpha |
| 3 | Rule Engine | 5.4 | ✅ **Complete** — v0.3 Alpha |
| 4 | PDF Workflow + Spatial Model | 5.1 | ◀ **Next** |
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

## Sprint 2 — Equipment Object System ✅

Spec 5.3. Implements [OBJECT_MODEL.md](../data-model/OBJECT_MODEL.md) and the Placement
part of [PROJECT_MODEL.md](../data-model/PROJECT_MODEL.md). Delivered as v0.2 Alpha.

| Deliverable | Where | |
| --- | --- | --- |
| Equipment object schema (Zod) and catalogue loader | `packages/object-library` | ✅ |
| JSON equipment database, first record: Vantive AK98 | `packages/object-library/catalog/` | ✅ |
| Placement geometry — footprint, clearance zones, ports | `packages/object-library` | ✅ |
| Object renderer with dimension display | `apps/web` | ✅ |
| Equipment palette, click-to-place, drag-to-move, delete | `apps/web` | ✅ |
| Draft data marking across palette, canvas and status bar | `apps/web` | ✅ |

**Acceptance criteria — met**

| Criterion | Result |
| --- | --- |
| A malformed catalogue file is rejected, naming the file and the field | ✅ 30 schema tests |
| A record marked `verified` without document, revision and section fails to load | ✅ |
| A missing field is rejected rather than treated as unknown | ✅ nullable-but-required |
| An AK98 measures its catalogue footprint at any zoom | ✅ ≤ 0.5 % error at 26.8 % zoom, shrinking with zoom |
| Changing a catalogue value changes what is drawn, with no code change | ✅ no dimension appears in any component |
| Draft data is visibly marked wherever it appears | ✅ palette badge, dashed outline, canvas label, status bar |
| 50 placed objects hold interactive frame rate (spec section 6) | ✅ median 16.6 ms frame time while panning |

Measurements in [PLAYWRIGHT_TEST_PLAN.md](../testing/PLAYWRIGHT_TEST_PLAN.md) and
[PERFORMANCE_TEST_PLAN.md](../testing/PERFORMANCE_TEST_PLAN.md).

**Deferred by decision:** undo/redo moves to a later editor-architecture sprint. Browser
tests stay manual until Sprint 3.

**Not blocked** by the missing AK98 measurements: the record ships as `draft`, and the real
figures replace placeholders without touching code.

## Sprint 3 — Rule Engine ✅

Spec 5.4. Where the product earns its purpose. **Rule engine only** — the spatial model
moved to Sprint 4.

| Deliverable | |
| --- | --- |
| Rule record schema, JSON-driven with no hard-coded thresholds | `packages/rule-engine` |
| Rule set loader from `standards/rules/` | |
| Clearance evaluation | |
| Equipment-to-equipment collision foundation | |
| GREEN / YELLOW / RED result model carrying the rule and its source | |
| Live violation overlay on the canvas, violation list panel | `apps/web` |
| Browser validation workflow, separate from the fast CI | `.github/workflows` |

**Out of scope, by decision:** `Space`, the room vocabulary and boundary collision. Room
boundaries are traced on an imported floor plan, so drawing them before the plan exists
means drawing them twice. They move to Sprint 4 with the rest of the spatial model; the
collision evaluator ships with an interface for boundary collision but no implementation.

**Acceptance criteria**

- A rule set with an invalid or duplicate record fails to load, naming the file and field.
- Editing the rule JSON changes the outcome with no code change.
- Threshold resolution records which source was applied — rule or equipment.
- An unknown threshold yields YELLOW with "threshold unknown", not a fourth status.
- **A result derived from draft data is never GREEN.**
- A violation of a draft rule is still reported at the rule's severity: provisional data
  must not hide a problem.
- Results are invariant under rotation and translation of the whole layout.

**Blocked by:** the real clearance figures and the manual revision they come from. The
engine is built and tested against fixtures; it cannot be seeded with anything true, so the
shipped rule set carries null thresholds until the manual arrives.

## Sprint 4 — PDF Workflow and Spatial Model ✅

Spec 5.1 and the "Scale Setting" item of 5.2, plus the spatial model moved from Sprint 3.

| Part | Deliverable |
| --- | --- |
| PDF workflow | PDF import · Scale calibration · Coordinate mapping |
| Spatial model | `Level` · `Space` · Boundary |

Floor plan **import**, not report output.

PDF Workflow means three distinct deliverables:

| # | Deliverable | What it produces |
| --- | --- | --- |
| 1 | **PDF import** | The hospital's drawing on screen as a raster underlay — PDF, PNG, JPG |
| 2 | **Scale calibration** | `millimetresPerPixel` — how large the drawing is |
| 3 | **Coordinate mapping** | The full pixel ↔ millimetre transform: scale **plus origin plus rotation** |

Scale alone is not a coordinate system. A correctly scaled plan with no origin gives
nothing to measure *from*, and a plan scanned three degrees off square puts every clearance
three degrees off. Hospital floor plans do not arrive square to the page, so the mapping is
a deliverable in its own right rather than a detail of calibration.

### Spatial model — moved here from Sprint 3

| Deliverable | |
| --- | --- |
| `Level`, `PlanImage`, `CoordinateMapping` in the document model | |
| **`Space`** — boundary polygon and the room function vocabulary | |
| **Boundary** — walls, and boundary collision in the rule engine | |
| Room tool, unlocked once `Space` exists | |
| Locked background layer beneath the design | |
| Project save / load with schema version and migration chain | |

Rooms are traced on the imported plan, which is why they belong here rather than a sprint
earlier: a boundary drawn without the drawing beneath it gets drawn twice.

The rule engine's boundary collision interface ships unimplemented in Sprint 3 and is
filled in here.

### Delivered

`packages/document-model` — the single definition of what a project is, and the package
that save, reporting, collaboration, AI-assisted design and a future facility twin all
read. See [../architecture/DOCUMENT_MODEL.md](../architecture/DOCUMENT_MODEL.md).

Two model changes were made while building it, both recorded in
[../data-model/PROJECT_MODEL.md](../data-model/PROJECT_MODEL.md):

- Placements hang off `Level` with a nullable `spaceId` rather than being owned by a
  `Space`. An engineer places a machine before drawing its room at least as often as the
  reverse, and a machine must survive its room being deleted.
- `Boundary` is its own entity with a `kind`, so a structural column can be represented
  without inventing a room for it.

Also delivered beyond the original list: **undo/redo** (owner addition), a command history
with explicit inverses, and internal polygon geometry — written rather than imported,
because the rule engine's separating axis test is convex-only and an L-shaped treatment
area is the ordinary case.

**Acceptance criteria**

| | |
| --- | --- |
| A hospital PDF is imported and mapped | ✅ PDF pages rasterised via pdf.js; PNG and JPG import directly |
| A machine overlapping a room boundary raises a collision result | ✅ `evaluators/boundary.ts`, 21 unit tests plus browser specs |
| A plan imported at an angle is measured correctly after rotation is set | ✅ `PlanTransform` carries rotation; `rotationFromReferenceLine` derives it |
| Model (0, 0) lands where the engineer put the origin, and survives reopening | ✅ round-trip test asserts field-for-field equality |
| An unmapped plan never yields GREEN | ✅ the calibration gate, plus a browser spec |
| A project saved on one machine opens identically on another | ✅ `.mfd.json`, validated both ways, plan image embedded |
| A 900 mm machine measures 900 mm against the drawing's own dimension lines | ⚠️ **not verified against a real hospital drawing** — see below |

The last one is the honest gap. The maths is tested (`planTransform.test.ts` asserts the
transform inverts exactly at arbitrary rotations, and `equipment.spec.ts` asserts a 900 mm
machine draws 900 mm on screen at every zoom), and a synthetic plan round-trips correctly
in the browser. What has not happened is an engineer calibrating against a real drawing's
printed dimension line and confirming the result. That needs a drawing we do not have.

Scoped to raster underlay. Vector PDF geometry extraction, DXF and DWG stay in the
specification's "Future" list.

## Sprint 5 — Report Generation

Spec 5.5. PDF installation review report: project information, layout image, equipment
list, engineering check results, installation checklist.

Sprint 4 leaves it well placed: the document already records which drawing was assessed,
how its scale was established, and which rule set produced every verdict — the three things
a report has to be able to state and cannot reconstruct later.

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
