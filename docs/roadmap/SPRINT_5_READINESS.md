# Sprint 5 Readiness Report

> Written at the end of Sprint 4 — PDF workflow and spatial model.
> Sprint 5 scope: PDF installation review report (TS Edition specification §5.5).

## Verdict

**Ready.** Every quality gate is green, and the three things a report has to be able to
state — which drawing was assessed, how its scale was established, and which rules
produced each verdict — are already recorded in the document rather than needing to be
reconstructed.

One acceptance criterion from Sprint 4 is **not met and cannot be met here**: nobody has
calibrated against a real hospital drawing's printed dimension line. That needs a drawing.
It is not a blocker for Sprint 5, and it is a blocker for shipping.

---

## 1. What Sprint 4 delivered

| | |
| --- | --- |
| `packages/document-model` | Project · Level · Boundary · Space · Placement · CoordinateMapping, with save, load and versioning |
| Plan import | PDF (rasterised via pdf.js), PNG, JPG — embedded in the document as a data URL |
| Scale calibration | Two-point, and stated-ratio; both keep their evidence |
| Coordinate mapping | Scale **plus** origin **plus** rotation, in `@mfd/cad-engine` |
| Spatial model | Traced room outlines, walls and obstructions; controlled room-function vocabulary |
| Boundary collision | The `BoundaryCollisionEvaluator` declared in Sprint 3, implemented |
| Calibration gate | An uncalibrated plan caps every result at YELLOW |
| Undo / redo | Command history with explicit inverses; one gesture is one step |
| Save / open | `.mfd.json`, validated in both directions |
| Polygon geometry | Ray-casting containment, segment intersection, area, simplification |

### Two model decisions worth re-reading before Sprint 5

Both were applied as recommended defaults and are recorded in
[../data-model/PROJECT_MODEL.md](../data-model/PROJECT_MODEL.md):

1. **Placements hang off `Level` with a nullable `spaceId`**, not off `Space`. An engineer
   places a machine before drawing its room at least as often as the reverse, and a machine
   has to survive its room being deleted.
2. **`Boundary` is its own entity with a `kind`.** A structural column is a real
   obstruction with no room-hood at all.

A third default — including `placement.create` in the undo scope — was applied without
comment. The owner's decision listed "Create Space" and "Delete operations"; placing a
machine and then being unable to undo it would have been the one gap in an otherwise
complete history.

## 2. Quality gates

| Gate | Result |
| --- | --- |
| Unit tests | **362** passing |
| Browser specs | **40** passing |
| Typecheck | Clean, strict, across six packages |
| Lint | Clean |
| Production build | Clean; pdf.js code-split into its own chunk |

Test counts by package:

| Package | Tests |
| --- | --- |
| `cad-engine` | 75 |
| `object-library` | 57 |
| `document-model` | 90 |
| `rule-engine` | 140 |

### Tests that were verified to fail

Two, because a test that has never failed is not known to work:

- **`result.shape.test.ts`** (Sprint 3.5) — a field was temporarily added to
  `EvaluationResult` and the lock fired.
- **`spatial.spec.ts` → "treats one drag as one undo step"** — coalescing was temporarily
  disabled and the spec failed by 252 px.

The second one had to be repaired twice before it was worth anything, and both repairs are
worth recording:

1. It first measured the **status bar's cursor readout**, which depends only on the pointer
   and the viewport. It would have passed whatever undo did. It now scans the canvas for
   the equipment fill.
2. It then **raced the repaint** — reading a canvas straight after an input event measures
   the previous frame. `expect.poll` retries; a bare `page.evaluate` does not.

## 3. Performance

Full figures in [../testing/PERFORMANCE_TEST_PLAN.md](../testing/PERFORMANCE_TEST_PLAN.md).
`pnpm bench` for the engine, `pnpm test:perf` for frame times.

**All five frame targets are met for the first time since the baseline was taken.**

| Measure, 50 objects | Sprint 3.5 | Sprint 4 | |
| --- | --- | --- | --- |
| Findings | 250 | 300 | ✅ one per machine from the new boundary rule |
| `evaluate()` | 4.54 ms | ~5.8 ms | ✅ the added work is the boundary pass. Re-measured at ~3.4 ms on an idle container — see the note in the performance plan; these figures carry ±60 % of background-load noise |
| Boundary collision pass alone | — | **0.37 ms** | ✅ |
| Panning (p95) | 16.8 ms | 17.3 ms | ✅ |
| Dragging one (p95) | 17.2 ms | 18.5 ms | ✅ |
| Dragging one (worst) | 63.8 ms | 18.7 ms | ✅ but see below |
| Placing 50 | 588 ms | 792 ms | ✅ |

**The plan underlay is free at interaction time.** A 3000 × 2000 PNG changes the frame
figures by less than measurement noise: it is one Konva `Image` node positioned by the same
`pixelToModel` → `worldToScreen` chain as everything else, so panning costs one transform
rather than one per drawing element. The only real cost is ~500 ms to decode it on import.

Two honest caveats:

- The **worst-frame improvement is partly method.** The drag gesture in this measurement is
  not the same one Sprint 3.5 used, so 63.8 → 18.7 ms overstates the gain. The p95 figures
  are comparable and are flat.
- Frame times are measured on a shared runner and are noisy. They are printed by an
  instrument, not asserted by a test — a flaky performance gate gets muted rather than
  fixed.

## 4. What Sprint 5 inherits in good order

| Need | Already here |
| --- | --- |
| "Which drawing was assessed" | `PlanImage.sourceFileName`, page index, pixel size, and the image itself |
| "How was the scale established" | `ScaleCalibration` — method, picked points, typed distance or stated ratio, timestamp |
| "Against which rules" | `project.ruleSetRef`, plus `ruleSetId`/`ruleSetVersion` on every report |
| "With which equipment data" | `placement.equipmentObjectVersion` per machine |
| Vector output rather than a screenshot | Geometry lives outside the renderer (AD-2); `worldToScreen` is the only place pixels appear |
| A frozen finding contract | `EVALUATION_RESULT_VERSION = 1`, locked by a shape test |
| Reproducibility | `evaluate` is pure; `saveDocument` produces the same bytes twice |

## 5. Open items

### Blocking for shipping, not for Sprint 5

| # | Item | Where |
| --- | --- | --- |
| A-1 | **AK98 installation manual data.** Four sprints in, the machinery is finished and empty: every finding still reads "threshold unknown". | [../OPEN_QUESTIONS.md](../OPEN_QUESTIONS.md) |
| A-2 | **Left / right side convention.** Implemented from the operator's viewpoint; a manual labelling sides from behind the machine inverts both side clearances. First thing to check when the manual arrives. | same |
| A-3 | **One real hospital drawing**, ideally scanned slightly off square, to verify the calibration end to end. | same |

### Decisions Sprint 5 will force

| # | Question |
| --- | --- |
| B-3 | **Liability posture.** The first report that leaves the building needs its disclaimer wording settled. Traceability is designed in; the sentence is not. |
| B-2 | **Report language.** Retrofitting a second language into a document generator is painful; deciding now costs almost nothing. |
| — | **What a report says when nothing is verified.** With no field group cited and every rule still draft, today's report would be a page of "threshold unknown". That may be exactly right — a review that honestly reports it could not conclude — but it is a product decision, not a technical one. |
| — | **How the report separates verified from draft.** Settled by the owner in Phase 4.5 and designed in [../architecture/REPORT_ENGINE_DESIGN.md](../architecture/REPORT_ENGINE_DESIGN.md): a verified block, a draft block, and the design footprint in neither, because it is a planning decision rather than an uncited measurement. |

### Non-blocking

> Items 1–4 below were the state at the end of Sprint 4. **Phase 4.5 delivered all four** —
> level switcher, obstruction drawing, vertex dragging, and click-to-place origin. They are
> kept here as written rather than deleted, because this document is the record of what was
> true when Sprint 5 was assessed. See [PHASE_4_5_REPORT.md](PHASE_4_5_REPORT.md).

| # | Item | Now |
| --- | --- | --- |
| 1 | The editor shows one level. The document model holds several; a level switcher is a small piece of UI whenever it is wanted. | Done, Phase 4.5 |
| 2 | Obstructions (columns, risers) can be evaluated against but cannot yet be **drawn** — the room tool always creates a `space_outline`. A kind selector is a small addition. | Done, Phase 4.5 |
| 3 | Boundary vertices are rendered as handles on the selected room but are not draggable. The command (`boundary.setVertices`) exists and is tested; only the drag gesture is missing. | Done, Phase 4.5 |
| 4 | Plan origin and rotation are settable through the document API and default honestly, but have no UI beyond the readout. An engineer cannot yet click to place the origin. | Origin done, Phase 4.5. Rotation still has no gesture. |
| 5 | A draft record becoming verified, observed through the browser, still needs a second catalogue record with a real citation to test against. | Still open — now D7 in the [Playwright plan](../testing/PLAYWRIGHT_TEST_PLAN.md), and narrowed by per-field-group verification: it needs one *group* cited, not a whole second record. |

Items 2–4 were all "the model and the commands are there, the gesture is not". None of them
blocked a report; each took an hour or two, which is what Phase 4.5 was.
