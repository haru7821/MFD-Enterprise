# Playwright Test Plan

> Browser-level verification for MFD-E TS Edition.
> Written in Sprint 2. **Not yet wired into CI** — see "Status" below.

## Status

The scenarios here are executed manually against a production build at the end of each
sprint, and their results are reported. They are not part of the CI workflow yet:
installing a browser adds minutes to every run, and the assertions worth locking down grow
substantially once the rule engine lands in Sprint 3.

**Committed to CI in Sprint 3**, alongside the validation results that make a regression
suite worth its runtime.

Run manually against `pnpm build && pnpm preview`.

---

## Scope

Three questions, in order of how much damage a regression would do:

1. **Does the drawing say what the catalogue says?** A machine drawn at the wrong size is
   the failure this product exists to prevent.
2. **Does draft data stay visible?** Placeholder figures must never look like manual
   figures.
3. **Does the canvas still work?** Navigation, placement, selection.

## 1. Browser rendering

| # | Scenario | Assertion |
| --- | --- | --- |
| R1 | Application loads | A `<canvas>` is present; console reports no errors or warnings |
| R2 | Catalogue renders from JSON | The palette lists every catalogue record, showing model, manufacturer and footprint read from the file |
| R3 | Arm and place | Clicking a catalogue entry then the canvas adds exactly one placement |
| R4 | Ports and clearances | Zones and port markers appear only for values the record actually has — a null clearance draws nothing |
| R5 | Selection | Clicking a placed object selects it; clicking empty canvas clears the selection |
| R6 | Drag | Dragging a selected object moves it without changing its drawn size |
| R7 | Delete | `Delete` removes the selected object and its geometry disappears from the canvas |
| R8 | Grid, zoom, pan | Wheel pans, `Ctrl`+wheel zooms about the cursor, `0` resets the view |

## 2. Dimension consistency

**The load-bearing test.** A drawn footprint must correspond to the catalogue value at
every zoom level.

### Method

Read the drawn footprint from canvas pixels, not from application state — state agreeing
with itself proves nothing.

1. Place one object and read the zoom percentage from the status bar.
2. `getImageData` over the canvas and select pixels matching the equipment **fill**.
3. Build per-row and per-column histograms; take the extent of rows and columns whose
   count exceeds a threshold.
4. Implied size = measured pixels ÷ (zoom ÷ 100), since 100 % is one pixel per millimetre.
5. Repeat across at least three zoom levels.

### Two traps this method exists to avoid

- **Measure the fill, not the stroke.** The draft stroke and the "DRAFT DATA" label are
  the same amber. A stroke-based scan measures the label as part of the machine.
- **Threshold rows and columns.** Anti-aliased text edges land in the same alpha window as
  the fill. A row crossing the footprint has hundreds of matching pixels; a row clipping
  a letter has a handful.

### Tolerance

| Zoom | Acceptable error |
| --- | --- |
| ≥ 25 % | ±1 % |
| 10–25 % | ±1.5 % |
| < 10 % | ±3 % |

The residual is the anti-aliased boundary — roughly one pixel lost on each edge,
independent of scale. **Error must shrink as zoom rises.** An error that stays constant in
percentage terms is a scale bug, not an edge effect, and fails the test regardless of
whether it sits inside the tolerance above.

### Measured — Sprint 2, Vantive AK98, catalogue 900 × 750 mm

| Zoom | Drawn | Implied | Error |
| --- | --- | --- | --- |
| 7.0 % | 62 × 51 px | 886 × 729 mm | −1.59 % / −2.86 % |
| 13.7 % | 122 × 102 px | 891 × 745 mm | −1.05 % / −0.73 % |
| 26.8 % | 240 × 200 px | 896 × 746 mm | −0.50 % / −0.50 % |

Error halves as zoom doubles — the signature of a constant edge loss rather than a scale
error.

## 3. Draft visibility

Draft data must be impossible to miss. Assertions:

| # | Where | Assertion |
| --- | --- | --- |
| D1 | Palette entry | `draft-badge` is visible on every draft record |
| D2 | Palette footer | States how many catalogue objects use placeholder figures |
| D3 | Canvas | Draft objects draw with a dashed amber outline, not a solid one |
| D4 | Canvas | A "DRAFT DATA" label appears next to each draft object above the label threshold |
| D5 | Status bar | `draft-placement-warning` appears whenever a draft object is placed, and reports the count |
| D6 | Upgrade path | Changing a record's `dataStatus` to `verified` (with complete source) removes every marking above, with no code change |

D6 is the one that matters most and is currently untested: it proves the draft treatment
is driven by data rather than hard-coded for the AK98. Add it in Sprint 3 with a fixture
catalogue.

## 4. Screenshot validation

Screenshots are captured as evidence rather than compared pixel-by-pixel. Pixel-diff
baselines are not adopted here: font rendering and anti-aliasing differ between machines,
and a suite that cries wolf on a font hint gets muted, at which point it protects nothing.

Captured each run:

| File | Shows |
| --- | --- |
| `s2-01-palette.png` | Catalogue palette with draft badge |
| `s2-02-placed.png` | One placed object at default zoom |
| `s2-03-zoomed.png` | The same object magnified — labels and dashes legible |
| `s2-04-selected.png` | Selection handles after a drag |
| `s2-05-fifty.png` | Fifty objects |

Reviewed by eye at the end of the sprint. The overlap between the "DRAFT DATA" label and
the object outline was found this way, not by an assertion.

## Test hooks

Stable `data-testid` attributes, so selectors do not depend on layout or copy:

| Hook | Element |
| --- | --- |
| `status-bar` | Status bar footer — the page has more than one `<footer>` |
| `catalog-item-<id>` | A catalogue palette entry |
| `draft-badge` | Draft marking in the palette |
| `draft-placement-warning` | Status bar draft warning |

## When this becomes CI

Sprint 3, with browser installation cached. Gate on: R1–R8, the dimension tolerance table,
and D1–D6.
