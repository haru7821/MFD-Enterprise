# Sprint 4 — Closure

> Closed by the product owner after Browser CI passed on `84cdaf3`.
> Covers Sprint 4 (PDF workflow and spatial model), Phase 4.5 (UX completion), and the two
> owner decisions that followed it.
> Shipped as **v0.4**.

---

## What was in scope, and what shipped

| # | Scope item | Shipped |
| --- | --- | --- |
| 1 | PDF import — hospital drawing as a raster underlay | ✅ PDF via pdf.js rasterisation, PNG and JPG direct |
| 2 | Scale calibration | ✅ two-point pick with a typed distance, and a stated ratio with dpi |
| 3 | Coordinate mapping — scale **plus** origin **plus** rotation | ✅ `PlanTransform`, invertible at arbitrary rotation |
| 4 | `Level`, `Space`, `Boundary` | ✅ `packages/document-model` |
| 5 | Room tool | ✅ tracing, renaming, area readout |
| 6 | Boundary collision in the rule engine | ✅ `evaluators/boundary.ts`, ray-cast containment |
| 7 | Project save / load with a migration chain | ✅ `.mfd.json`, `DOCUMENT_VERSION = 2`, real v1 → v2 migration |
| 8 | Locked background layer | ✅ |
| — | Undo / redo (owner addition mid-sprint) | ✅ command history with explicit inverses |
| — | Internal polygon geometry (not in the list, forced by the work) | ✅ written rather than imported — see below |

### Phase 4.5, added by the owner before report generation

| # | Scope item | Shipped |
| --- | --- | --- |
| 1 | Origin placement by mouse click, with undo | ✅ and it renumbers the coordinates without moving the layout on screen |
| 2 | Boundary vertex editing — select, drag, insert, delete, snapping | ✅ |
| 3 | Obstruction objects — columns, shafts, fixed obstacles | ✅ stored and typed; evaluated by the Sprint 4 boundary rule |
| 4 | Level switcher | ✅ add, rename, delete, switch, per-level plan and rooms |

### Owner decisions taken after Phase 4.5

| Decision | Outcome |
| --- | --- |
| Separate manufacturer dimensions from design footprint | ✅ `manufacturerDimensions` is immutable reference data nothing computes with; `designFootprint` is what the canvas, placement, collision and layout engines measure. Verified by pointing the geometry at the wrong field — 10 of 18 tests failed. |
| Verification per **field group**, not per record | ✅ six groups each carry their own status and source; a finding is provisional only if a group it read is |
| Report language | ✅ bilingual Korean + English, designed in `REPORT_ENGINE_DESIGN.md § D` |
| Liability statement | ✅ frozen verbatim in both languages, emitted last |
| Browser CI output | ✅ PASS/FAIL and execution time only |

---

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| A hospital PDF is imported and mapped | ✅ |
| A machine overlapping a room boundary raises a collision result | ✅ 22 unit tests plus browser specs |
| A plan imported at an angle is measured correctly once rotation is set | ✅ the transform inverts exactly at arbitrary rotation |
| Model (0, 0) lands where the engineer put it, and survives reopening | ✅ field-for-field round trip |
| An unmapped plan never yields GREEN | ✅ calibration gate, plus a browser spec |
| A project saved on one machine opens identically on another | ✅ plan image embedded as base64 |
| A 900 mm machine measures 900 mm against a drawing's own dimension lines | ❌ **not verified against a real hospital drawing** |

### The one criterion not met, stated plainly

Nobody has calibrated VantiCAD Layout against a real hospital drawing's printed dimension line and
confirmed the result. What *is* verified: the transform inverts exactly at arbitrary rotation
(unit), a machine draws its catalogue size on screen at every zoom (browser, pixel-measured),
and a synthetic plan round-trips through import, calibration and reopen.

That is the maths and the rendering. It is not the same as the claim, and the claim needs a
drawing the project does not have. **This does not block Sprint 5** — a report of a
calibration is only as good as the calibration, so it stays open until a real drawing exists,
and it is recorded in `OPEN_QUESTIONS` A-3 rather than quietly folded into a tick.

---

## Quality gates at closure

| Gate | Result |
| --- | --- |
| Unit tests | **402** across 23 files |
| Browser specs | **65** |
| Typecheck | Clean — strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, six packages |
| Lint | Clean, including the enforced package-boundary rule |
| Production build | Clean |
| CI (typecheck · lint · unit · build) | ✅ green |
| Browser CI (Playwright) | ✅ green |

Test growth over the sprint: 362 → 402 unit, 40 → 65 browser.

---

## Defects found and fixed during Sprint 4 and Phase 4.5

Nine, of which seven were only reachable by moving a hand:

| # | Defect |
| --- | --- |
| 1 | `parseDocument` migrated a v1 file's content but left `documentVersion` at 1 — invisible on disk, because saving restamps it |
| 2 | Obstruction overlap depth was measured one way only, so a machine straddling a column edge reported no depth |
| 3 | Setting the plan origin slid the whole floor on screen |
| 4 | Undo of an origin change did not pan the view back |
| 5 | Vertex handles were drawn while a tracing tool was armed — visible and dead |
| 6 | The obstruction inspector reported a *room's* vertex count, so two panels described one fact |
| 7 | Renaming a room produced one undo step per keystroke |
| 8 | A browser spec read the canvas one frame early and flaked under parallel load |
| 9 | `pnpm lint` walked the Playwright html report's bundled trace viewer once that reporter was enabled — 3,981 errors in third-party minified code |

## Tests verified to fail

Six checks were confirmed capable of failing before being trusted, because a test that cannot
fail is a comment:

| Check | Broken by | Result |
| --- | --- | --- |
| Origin renumbers the coordinates | Zeroing the viewport compensation | Failed ✅ |
| Vertex snapping | Disabling snapping | Failed ✅ |
| Rotated-plan origin shift | Flipping the rotation sign | Failed ✅ |
| Drag coalescing is one undo step | Disabling merge | Failed by 252 px ✅ |
| Geometry reads the design footprint | Pointing it at manufacturer dimensions | 10 of 18 failed ✅ |
| The palette states all six field groups | Rendering five | Failed on count ✅ |
| Browser CI reports FAIL | A deliberately failing spec | Printed FAIL, exit 1 ✅ |

Two lessons recorded rather than filed away. `pnpm build` typechecks first, so a negative
check written with non-compiling code silently tests the *previous* bundle — one round of
verification had to be redone. And the engine benchmark carries ±60 % background-load noise
on this machine, so a single run cannot prove a change was free; the footprint split was
**not** credited with its apparent speedup.

---

## What Sprint 4 deliberately did not do

| | Why |
| --- | --- |
| Vector PDF geometry extraction, DXF, DWG | Specification "Future" list. Scoped to a raster underlay. |
| Plan **rotation** gesture | The transform carries rotation and the panel reads it out, but nothing drags it. It has the same "everything slides" property the origin had, so it needs the same compensation when it gets a UI. |
| Wall tracing | `kind: 'wall'` is modelled and evaluated; nothing draws one. A wall wants thickness and a centreline, which is its own small design. |
| Elevation editing | `Level.elevation` is in the model and settable through the API; it matters when levels stack, which nothing yet does. |
| Multi-select | Not asked for, and a review edits one thing at a time. |

---

## Carried into Sprint 5

| # | Item |
| --- | --- |
| 1 | **A-1 — the AK98 installation data package.** Service clearances and a citation. Still the single blocker on the product's purpose: the machinery is finished and empty. |
| 2 | **A-3 — one real hospital drawing**, for the calibration criterion above. |
| 3 | `useEvaluation` evaluates the active level; the report needs every level. Two call sites, one `evaluate` — see `REPORT_ENGINE_DESIGN.md § H`. |
| 4 | Finding prose is English-only. Bilingual reasons need findings to carry a reason code plus parameters, which reopens `EVALUATION_RESULT_VERSION`. Raised as decision 8, recommended for Sprint 6. |
| 5 | D7 — a field group flipping to verified, observed through the browser. Needs one real citation, not a whole second record. |

## State handed over

| | |
| --- | --- |
| Branch | `claude/mfd-enterprise-structure-d7gmoq` |
| Closing commit | `84cdaf3` |
| Document contract | `DOCUMENT_VERSION = 2`, one migration, round-trip tested |
| Evaluation contract | `EVALUATION_RESULT_VERSION = 1`, frozen, shape-locked |
| Packages | `cad-engine`, `object-library`, `rule-engine`, `document-model`, `report-engine` (scaffold) |
| Rule sets | `standards/rules/dialysis/` — three files, every rule `draft`, thresholds null |
| Catalogue | `vantive_ak98` 0.3.0, `dialysis_bed` 0.2.0 — every field group `draft` |
