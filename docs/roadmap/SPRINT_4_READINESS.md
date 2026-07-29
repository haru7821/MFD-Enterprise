# Sprint 4 Readiness Report

> Produced by Sprint 3.5 stabilisation. No features were added.
> Sprint 4 scope: PDF Import · Scale Calibration · Coordinate Mapping · Level · Space · Boundary.

## Verdict

**Not ready.** One defect found by the performance baseline should be fixed first, and it
is small. Everything else is green.

The defect is not in Sprint 4's path — it is in what Sprint 4 would be built on top of.
Adding an imported floor plan, a spatial model and boundary collision to a validator that
already stutters at the specification's own object count would make the cause much harder
to find later.

---

## 1. Evaluation result contract — frozen ✅

`EVALUATION_RESULT_VERSION = 1`.

Locked by `packages/rule-engine/src/result.shape.test.ts`, which asserts the **exact** key
set of `EvaluationResult` and `EvaluationReport`. Adding a field fails the build. Verified
by temporarily adding one and confirming the failure — a lock that does not fire is not a
lock.

Also asserted: JSON round-trip fidelity (the contract crosses a network boundary in
Sprint 5), no `undefined` values, level counts summing to the result count, and
worst-first ordering.

Documented in [../architecture/RULE_ENGINE_API.md](../architecture/RULE_ENGINE_API.md).

## 2. API documentation ✅

[RULE_ENGINE_API.md](../architecture/RULE_ENGINE_API.md) covers input model, output model,
status definitions, error handling and future extension points, as requested.

The error-handling section is the one worth reading before Sprint 4: it sets out which
failures throw at load, which become a `YELLOW` result, and which are skipped — and
`BoundaryCollisionEvaluator` is the extension point Sprint 4 fills in.

## 3. Performance baseline ⚠️

Full figures in [../testing/PERFORMANCE_TEST_PLAN.md](../testing/PERFORMANCE_TEST_PLAN.md).
Re-runnable with `pnpm bench`.

| Measure, 50 objects | Result | |
| --- | --- | --- |
| `evaluate()` | 5.18 ms | ⚠️ a third of a frame |
| Collision pass alone | 1.60 ms | ✅ |
| Frame time, panning (median) | 16.6 ms | ✅ |
| Frame time, panning (p95) | 27.2 ms | ❌ |
| Frame time, dragging one (worst) | 123.3 ms | ❌ visible stutter |
| Placing 50 objects | 1,493 ms | ❌ was 196 ms in Sprint 2 |
| Findings produced | **1,425** | ❌ |

### The defect

Fifty machines produce 1,425 findings: 200 clearance and **1,225 collision — one per pair,
whether or not the pair overlaps**. The engine emits them all and the panel renders them
all as DOM rows, re-rendering on every pointer move during a drag.

The geometry is not the problem. 1,225 rotated-rectangle overlap tests take 1.6 ms. The
cost is emitting and rendering a result for every pair that is perfectly fine.

And it fails as a report before it fails as a performance matter: an engineer who places
fifty machines opens the findings panel to 1,225 rows telling them two machines do not
overlap.

### Proposed fix — needs approval, not implemented

**One result per governed placement instead of one per pair**: "this machine does not
overlap anything" (50 results), plus a pair result only where an overlap actually exists.

That keeps the positive assurance — the check ran, and it passed — while collapsing 1,225
rows to 50. Expected: findings 1,425 → 250, `evaluate()` well under 2 ms, and the drag
stutter gone with it.

It is a change to *which* results are emitted, not to their shape, so the frozen contract
and its version are unaffected. Roughly thirty lines in `evaluators/collision.ts` plus
tests.

Held for approval because it changes evaluation semantics, and every semantic decision in
this project so far has been yours to make.

**Alternative if you would rather not change semantics:** virtualise the findings list so
only visible rows are in the DOM. That fixes the stutter and leaves 1,225 rows of noise in
the report.

## 4. CI verification ✅

Commit `5e37110`, both workflows on the same push:

| Workflow | Result | Duration | Steps |
| --- | --- | --- | --- |
| **CI** (fast) | ✅ success | 30 s | typecheck 7 s · lint 3 s · test 2 s · build 4 s |
| **Browser** | ✅ success | 49 s | Chromium install 26 s · build 4 s · 17 Playwright specs 9 s |

The separation works as intended: type, lint and unit feedback returns in half a minute
without queueing behind a browser download.

## 5. Test coverage

| | Count |
| --- | --- |
| Unit tests | **189** |
| Browser specs | **17** |

Rule engine holds 109 of the unit tests, including 14 rotation and translation invariants
and 9 contract-shape locks.

---

## Blocking items for Sprint 4

| # | Item | Owner |
| --- | --- | --- |
| 1 | Collision findings volume — approve the fix above | Product owner |

## Non-blocking, but decide before Sprint 4 finishes

| # | Item | Why it matters now |
| --- | --- | --- |
| 2 | **AK98 installation manual data** | Sprint 4 can be built without it, but if it never arrives the MVP completes without the product ever producing a GREEN. Every finding today reads "threshold unknown". |
| 3 | **Left / right side convention** | Implemented from the operator's viewpoint. A manual labelling sides from behind the machine inverts both side clearances. First thing to check when the manual arrives — it cannot be settled from the code. |
| 4 | Undo / redo | Sprint 4 adds room drawing and plan calibration. Both are far more painful to get wrong without an undo than equipment placement was. |
| 5 | Vector PDF expectations | The plan assumes a raster underlay the engineer works on top of. If engineers expect walls detected from a vector PDF, Sprint 4 grows substantially. |

## What Sprint 4 inherits in good order

- A frozen, JSON-safe result contract with a build-enforced lock
- A rule engine with no hard-coded thresholds, proven by rotation and translation invariance
- `BoundaryCollisionEvaluator` declared and waiting for walls
- `Level`, `PlanImage` and `CoordinateMapping` specified in
  [PROJECT_MODEL.md](../data-model/PROJECT_MODEL.md), including why an uncalibrated plan
  must yield YELLOW rather than GREEN
- Two CI workflows, both green, one of them fast
- A re-runnable performance baseline to measure Sprint 4's additions against
