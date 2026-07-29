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

Chromium, 1440 × 900 viewport, production build, 50 AK98 objects.

| Metric | Measured | Target | |
| --- | --- | --- | --- |
| Median frame time | 16.6 ms | ≤ 16.7 ms | ✅ |
| p95 frame time | 16.8 ms | ≤ 20 ms | ✅ |
| Worst frame | 16.9 ms | ≤ 33 ms | ✅ |
| Placement of 50 objects | 196 ms total | — | ✅ |

Frame time sits on the vsync interval throughout, so rendering is not the limiting factor
at this object count. **Specification section 6 is met.**

The 196 ms figure includes Playwright's round trip per click and is a responsiveness
observation, not a rendering measurement.

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
| 3 | Re-measure with clearance zones and validation overlays drawn — every object gains up to four polygons |
| 3 | 200 objects, to find where culling stops carrying it |
| 4 | Measure with a full-resolution plan image as an underlay |
| 4 | Measure the pixel→millimetre coordinate mapping cost during pan |

## Reproducing

Not yet a committed suite — see [PLAYWRIGHT_TEST_PLAN.md](PLAYWRIGHT_TEST_PLAN.md) for why
browser execution enters CI in Sprint 3. Until then this is run by hand against
`pnpm build && pnpm preview`, and its numbers are recorded above each time it runs.
