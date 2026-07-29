# Sprint 4 Readiness Report

> Produced by Sprint 3.5 stabilisation. No features were added.
> Sprint 4 scope: PDF Import · Scale Calibration · Coordinate Mapping · Level · Space · Boundary.

## Verdict

**Ready.** The one blocking defect — collision findings growing with the square of the
machine count — was approved and fixed. Every quality gate is green and the outstanding
items are decisions for the product owner rather than work in the code.

> Original verdict, before the fix: *not ready*. Kept below for the record, since the
> measurement that produced it is what justified the change.

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

## 3. Performance baseline ✅

Full figures in [../testing/PERFORMANCE_TEST_PLAN.md](../testing/PERFORMANCE_TEST_PLAN.md).
Re-runnable with `pnpm bench`.

| Measure, 50 objects | Baseline | After fix | |
| --- | --- | --- | --- |
| Findings produced | 1,425 | **250** | ✅ |
| `evaluate()` | 5.18 ms | **4.54 ms** | ✅ |
| Collision pass alone | 1.60 ms | **1.08 ms** | ✅ |
| Frame time, panning (p95) | 27.2 ms | **16.8 ms** | ✅ |
| Frame time, dragging one (p95) | 31.9 ms | **17.2 ms** | ✅ |
| Frame time, dragging one (worst) | 123.3 ms | **63.8 ms** | ⚠️ target 50 ms |
| Placing 50 objects | 1,493 ms | **588 ms** | ✅ |

The remaining outlier is one frame in ninety while dragging, behind a 17.2 ms p95. What is
left in it: a drag re-runs `evaluate()` on every pointer move and re-renders 250 rows with
it. Memoising rows or debouncing evaluation during a drag would remove it; neither was done,
because a 63 ms spike behind a smooth p95 does not justify more scope before Sprint 4.

### The defect, and what was done about it

Fifty machines produced 1,425 findings: 200 clearance and **1,225 collision — one per pair,
whether or not the pair overlapped**. It failed as a report before it failed as
performance: an engineer who placed fifty machines opened the findings panel to 1,225 rows
saying two machines do not overlap.

**Fixed, after approval, as an equipment-centred issue model.** Each governed machine
reports on itself: one finding when clear, one finding per machine it collides with. A
single collision among fifty gives fifty findings — forty-eight clear and two RED, one
anchored on each machine involved, because an engineer inspecting either has to see it.

No field was added. `placementIds[0]` is the subject, `placementIds[1]` the machine it
collides with, `category` the issue type, `measured` the penetration —
`EVALUATION_RESULT_VERSION` stays at 1 and the shape lock still passes.

Two things were learned doing it, both recorded because they were not obvious:

1. **The first attempt made the geometry slower.** Having each machine compare itself
   against every other tested every pair twice and recomputed every footprint *n* times;
   the collision pass went from 1.60 ms to 2.46 ms. Restoring a single pass over unordered
   pairs, with footprint corners computed once per machine, brought it to 1.08 ms.
2. **Fewer findings did not by itself make the engine faster.** The O(n²) overlap tests
   still happen — only the emitting stopped. The engine gain came from the pair loop and
   the corner reuse; the *findings* gain is what fixed the panel.

`collisionVolume.test.ts` now asserts that findings grow linearly with machine count, so
the quadratic shape cannot return unnoticed.

## 4. CI verification ✅

| Commit | Workflow | Result | Duration |
| --- | --- | --- | --- |
| `5e37110` Sprint 3 | CI (fast) | ✅ success | 30 s |
| `5e37110` Sprint 3 | Browser | ✅ success | 49 s |
| `1fbac78` Sprint 3.5 | CI (fast) | ✅ success | ~30 s |
| `1fbac78` Sprint 3.5 | Browser | ✅ success | 55 s |

The separation works as intended: type, lint and unit feedback returns in half a minute
without queueing behind a browser download.

## 5. Test coverage

| | Count |
| --- | --- |
| Unit tests | **199** |
| Browser specs | **19** |

Rule engine holds 119 of the unit tests, including 14 rotation and translation invariants,
9 contract-shape locks and 10 findings-volume regressions.

Requirement 6 of the approved change — preserve rotation invariance, translation
invariance, the draft policy and threshold resolution — is held by the existing suites,
which pass unchanged.

---

## Blocking items for Sprint 4

None.

## Non-blocking, but decide before Sprint 4 finishes

| # | Item | Why it matters now |
| --- | --- | --- |
| 1 | **AK98 installation manual data** | Sprint 4 can be built without it, but if it never arrives the MVP completes without the product ever producing a GREEN. Every finding today reads "threshold unknown". |
| 2 | **Left / right side convention** | Implemented from the operator's viewpoint. A manual labelling sides from behind the machine inverts both side clearances. First thing to check when the manual arrives — it cannot be settled from the code. |
| 3 | Undo / redo | Sprint 4 adds room drawing and plan calibration. Both are far more painful to get wrong without an undo than equipment placement was. |
| 4 | Vector PDF expectations | The plan assumes a raster underlay the engineer works on top of. If engineers expect walls detected from a vector PDF, Sprint 4 grows substantially. |

## What Sprint 4 inherits in good order

- A frozen, JSON-safe result contract with a build-enforced lock
- A rule engine with no hard-coded thresholds, proven by rotation and translation invariance
- `BoundaryCollisionEvaluator` declared and waiting for walls
- `Level`, `PlanImage` and `CoordinateMapping` specified in
  [PROJECT_MODEL.md](../data-model/PROJECT_MODEL.md), including why an uncalibrated plan
  must yield YELLOW rather than GREEN
- Two CI workflows, both green, one of them fast
- A re-runnable performance baseline to measure Sprint 4's additions against
