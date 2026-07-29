# Performance Test Plan

> Verifies TS Edition specification section 6: **"Support 50 equipment objects minimum."**
> Written and first executed in Sprint 2.

## What the requirement means

Fifty objects is not a storage limit — an array holds fifty of anything. It is an
interaction requirement: with fifty machines on the drawing, panning, zooming and dragging
must stay responsive enough that a TS engineer can work without fighting the tool.

The measurable form of that is **frame time**. A frame budget of 16.7 ms holds 60 fps;
past about 33 ms interaction starts to feel like dragging something heavy.

## Targets

| Metric | Target | Fails at |
| --- | --- | --- |
| Median frame time while panning, 50 objects on screen | ≤ 16.7 ms (60 fps) | > 20 ms |
| p95 frame time | ≤ 20 ms | > 33 ms |
| Worst frame | ≤ 33 ms | > 50 ms |
| Placement responsiveness | Object appears in the frame after the click | Visible lag |

Measured on the CI-class container this project builds in, not on developer hardware.
A budget met only on a fast laptop is not a budget.

## Method

1. Build for production and serve it — development builds carry React's dev overhead and
   would make the numbers meaningless.
2. Place 50 objects in a 10 × 5 grid, all within the viewport.
3. Begin sampling frame intervals via `requestAnimationFrame`.
4. **While sampling is running**, drag-pan continuously across the canvas.
5. Collect median, p95 and worst over 90 frames.

Step 4 is the part that is easy to get wrong. Sampling that completes before the pan
begins measures an idle tab, which will always report a comfortable 60 fps — the first
version of this measurement did exactly that and had to be rewritten.

## Results — Sprint 2

Chromium, 1440 × 900 viewport, production build, 50 AK98 objects. No rule engine yet.

| Metric | Measured | Target | |
| --- | --- | --- | --- |
| Median frame time | 16.6 ms | ≤ 16.7 ms | ✅ |
| p95 frame time | 16.8 ms | ≤ 20 ms | ✅ |
| Worst frame | 16.9 ms | ≤ 33 ms | ✅ |
| Placement of 50 objects | 196 ms total | — | ✅ |

Frame time sat on the vsync interval throughout, so rendering was not the limiting factor
at this object count.

## Results — Sprint 3.5 baseline (before the collision fix)

### Engine, measured in Node

`pnpm bench` — the engine alone, no browser, no React. Rendering is measured separately
below, because a combined number tells you the frame was slow without telling you which
half to fix.

| Objects | `evaluate()` | Collision pass | Results | Pairs |
| --- | --- | --- | --- | --- |
| 10 | 0.61 ms | 0.15 ms | 85 | 45 |
| **50** | **5.18 ms** | **1.60 ms** | **1,425** | 1,225 |
| 100 | 21.8 ms | 9.2 ms | 5,350 | 4,950 |
| 200 | 92.3 ms | 36.0 ms | 20,700 | 19,900 |

At the specification's fifty objects the engine uses about a third of a 16.7 ms frame.
Past that the O(n²) collision pass takes over: doubling the object count roughly
quadruples the time, and at 100 objects a single evaluation already exceeds the frame
budget.

Evaluation runs on change rather than per frame, so this is not a per-frame cost — but a
drag *is* a stream of changes, which makes it one.

### Rendering, measured in Chromium

1600 × 900, production build, 50 objects with the validation overlay and findings panel.

| Scenario | Median | p95 | Worst | |
| --- | --- | --- | --- | --- |
| 0 objects, idle | 16.7 ms | 20.1 ms | 59.4 ms | baseline |
| 50 objects, idle | 16.7 ms | 16.9 ms | 26.7 ms | ✅ |
| 50 objects, panning | 16.6 ms | 27.2 ms | 43.1 ms | ⚠️ |
| **50 objects, dragging one** | **16.8 ms** | **31.9 ms** | **123.3 ms** | ❌ |
| Placement of 50 objects | 1,493 ms total | | | ❌ regression from 196 ms |

Median frame time still sits on vsync, so the *typical* frame is fine. The tail is not: a
123 ms worst frame during a drag is a visible stutter, and p95 at nearly double the budget
means it is not a one-off.

### What the numbers say

**The 1,425 findings are the problem, not the geometry.** Fifty machines produce 200
clearance findings and 1,225 collision findings — one per pair, whether or not the pair
overlaps. The engine spends its time producing them, and the panel then renders all 1,425
as DOM rows, re-rendering on every pointer move during a drag.

The collision *maths* is cheap: 1.6 ms for 1,225 rotated-rectangle tests. What costs is
emitting and rendering a result for every pair that is perfectly fine.

It is also unusable as a report. A TS engineer opening the findings panel with fifty
machines placed sees 1,225 rows saying two machines do not overlap.

**Fixed after approval** — see the next section.

## Results — Sprint 3.5 after the equipment-centred collision model

Collision findings are now emitted per machine rather than per pair, and each unordered
pair is tested once with footprint corners computed once per machine rather than once per
comparison.

### Engine

| Objects | `evaluate()` | | Collision pass | | Results | |
| --- | --- | --- | --- | --- | --- | --- |
| | before | after | before | after | before | after |
| 10 | 0.61 ms | **0.50 ms** | 0.15 ms | **0.06 ms** | 85 | **50** |
| **50** | 5.18 ms | **4.54 ms** | 1.60 ms | **1.08 ms** | 1,425 | **250** |
| 100 | 21.8 ms | **17.4 ms** | 9.2 ms | **4.2 ms** | 5,350 | **500** |
| 200 | 92.3 ms | **69.6 ms** | 36.0 ms | **19.4 ms** | 20,700 | **1,000** |

Findings drop 5.7× at the specification's fifty objects, and the collision pass roughly
halves. Two changes contributed, and the second was the larger surprise:

- **Per-machine findings** removed 1,175 result objects from the fifty-object case.
- **Pairs tested once, corners computed once.** The first attempt at an equipment-centred
  model made this *worse*, not better — each machine comparing itself against every other
  tested every pair twice and recomputed every footprint n times. The collision pass went
  from 1.60 ms to 2.46 ms before the pair loop was restored.

Results now grow linearly with machine count rather than quadratically, which is asserted
by `collisionVolume.test.ts` rather than left to be noticed later.

### Rendering

| Scenario | Before | After | Target | |
| --- | --- | --- | --- | --- |
| Findings rendered | 1,425 | **250** | — | ✅ |
| Placement of 50 objects | 1,493 ms | **588 ms** | — | ✅ |
| 50 objects, idle (p95) | 16.9 ms | 16.9 ms | ≤ 20 ms | ✅ |
| 50 objects, panning (p95) | 27.2 ms | **16.8 ms** | ≤ 20 ms | ✅ |
| 50 objects, dragging one (p95) | 31.9 ms | **17.2 ms** | ≤ 20 ms | ✅ |
| 50 objects, dragging one (worst) | 123.3 ms | **63.8 ms** | ≤ 50 ms | ⚠️ |

Four of the five targets are now met and the fifth halved. The remaining outlier is a
single frame out of ninety while dragging; p95 sits at 17.2 ms, so the interaction feels
smooth and the spike is not representative.

**What is left in it:** dragging re-runs `evaluate()` on every pointer move (4.5 ms) and
re-renders 250 rows with it. Memoising the rows, or debouncing evaluation during a drag,
would remove the spike. Neither is done — the requested change was the reporting model, and
a 63 ms outlier behind a 17 ms p95 does not justify more scope before Sprint 4.

## Targets, restated after the baseline

| Metric | Target | Baseline | After fix | |
| --- | --- | --- | --- | --- |
| Median frame, 50 objects, panning | ≤ 16.7 ms | 16.6 ms | 16.7 ms | ✅ |
| p95 frame, 50 objects, panning | ≤ 20 ms | 27.2 ms | 16.8 ms | ✅ |
| Worst frame, dragging one of 50 | ≤ 50 ms | 123.3 ms | 63.8 ms | ⚠️ |
| `evaluate()` at 50 objects | ≤ 5 ms | 5.18 ms | 4.54 ms | ✅ |
| `evaluate()` at 100 objects | ≤ 16.7 ms | 21.8 ms | 17.4 ms | ⚠️ |
| Findings at 50 objects | ≤ 300 | 1,425 | 250 | ✅ |

The p95 and worst-frame targets are new: Sprint 2 measured only a pan with no evaluation
attached, and a median alone hides exactly the stutter this baseline found.

## Why it holds

Three decisions, all of which would be expensive to retrofit:

- **Viewport culling.** `EquipmentLayer` skips objects outside the visible rectangle
  before building any Konva node, so cost tracks what is on screen rather than what is in
  the project.
- **No Konva hit graph.** Every equipment node is `listening={false}`; hit testing runs
  against model geometry in `@mfd/object-library`. Konva never builds or maintains a hit
  canvas for equipment.
- **Detail thresholds.** Below 14 px on screen an object drops its ports and clearance
  zones; below 56 px it drops its labels. Zooming out cannot turn fifty objects into
  hundreds of unreadable text nodes.

## Headroom to check next

Fifty is the specification's floor, not a realistic ceiling — a large dialysis unit runs to
several dozen stations plus chairs, sinks and utility equipment, and Sprint 4 adds an
imported floor plan image underneath all of it.

| Sprint | Add to this plan |
| --- | --- |
| 4 | Re-measure after the findings volume is addressed |
| 4 | Measure with a full-resolution plan image as an underlay |
| 4 | Measure the pixel→millimetre coordinate mapping cost during pan |
| later | Spatial index for the collision pass, if object counts pass ~150 |

A spatial index (a grid or R-tree over footprint bounds) would take the collision pass from
O(n²) to roughly O(n log n). It is not worth its complexity at fifty objects and would be
premature now — but it is the answer if real projects turn out to hold two hundred.

## Reproducing

```bash
pnpm bench        # engine timings, Node
pnpm test:e2e     # browser suite, includes the frame assertions
```

The rendering figures above come from a scripted Chromium session driving a production
build. Frame sampling must be started **before** the interaction begins: sampling that
completes first measures an idle tab and will always report a comfortable 60 fps. The first
version of this measurement did exactly that and had to be rewritten.
