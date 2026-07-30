# Playwright Test Plan

> Browser-level verification for MFD-E TS Edition.
> Written in Sprint 2, committed and wired into CI in Sprint 3.

## Status — committed and running in CI as of Sprint 3

87 specs in `tests/e2e/`, run by `.github/workflows/browser.yml`, **separate from the fast
`ci.yml`**. Since Sprint 5 that workflow reports only PASS/FAIL and the execution time; the failing
spec, its error, its screenshot and its retry trace are in the uploaded artifact.

Installing a browser costs minutes; the typecheck / lint / unit gate answers in
under one, and should keep doing so. The two workflows run alongside each other, so a
failing lint reports in seconds rather than queueing behind a browser download.

```bash
pnpm test:e2e          # against a production build, started automatically
pnpm test:e2e:ui       # interactive
```

The config takes `CHROMIUM_PATH` as an escape hatch for sandboxes that ship a browser at a
version Playwright did not download. CI leaves it unset.

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

### Tolerance — a pixel budget, not a percentage

**±6 pixels at every zoom level**, plus ±3 % relative error where the object is at least
25 % zoom.

The residual is fixed and scale-independent: the anti-aliased fill boundary, plus the
validation outline drawn over it, together lose about two pixels per edge. Expressed as a
percentage that becomes 6 % on a small object and 0.5 % on a large one, which would force
the low-zoom tolerance so wide it could no longer catch a real scale error. A pixel budget
matches the physics and stays strict.

**The relative error must also shrink as zoom rises.** One that stays constant in
percentage terms is a scale bug wearing an edge effect's clothing, and fails the test even
if every absolute measurement sits inside the budget.

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
| D1 | Palette entry | `draft-badge` is visible on every record with a draft field group |
| D2 | Palette footer | States how many catalogue objects have placeholder fields |
| D3 | Canvas | Objects with any draft group draw with a dashed amber outline, not a solid one |
| D4 | Canvas | A "DRAFT DATA" label appears next to each such object above the label threshold |
| D5 | Status bar | `draft-placement-warning` appears whenever one is placed, and reports the count |
| D6 | Palette entry | Six `data-status` chips per record — one per field group — each carrying its own status and a tooltip with either the citation or the reason there is none |
| D7 | Upgrade path | Citing a field group flips that chip to `verified` and leaves the others alone, with no code change |

D6 is asserted in `equipment.spec.ts` ("states verification per field group, not per record"),
which also pins that all six groups are named — a missing chip fails on the count rather than
passing quietly.

D7 was verified by hand during Phase 4.5 by citing the AK98's dimensions from a manual and
observing the mixed record render as mixed, then reverting. It is not a standing spec, because
that would mean either a fixture catalogue served to the app or shipping a citation the owner
has not supplied. Worth making standing when a second, verified equipment record exists.

## 4. Rule engine (Sprint 3)

| # | Scenario | Assertion |
| --- | --- | --- |
| V1 | Rule set identity | The panel names the rule set and version stamped into results |
| V2 | Evaluation on placement | Placing one machine produces its four clearance findings |
| V3 | Unknown threshold | Reported YELLOW as `RC-110`, in both languages — no fourth status |
| V4 | No GREEN while provisional | With the shipped draft rule set, `result-badge-GREEN` never appears |
| V5 | Collision | Two overlapping machines raise RED, reporting the overlap in millimetres |
| V6 | Collision clears | Dragging them apart removes the RED |
| V7 | Provenance | Every finding states its source, or says explicitly that there is none |

## 5. Plan workflow, rooms and undo (Sprint 4)

`tests/e2e/spatial.spec.ts`, 21 specs. These cover what a unit test cannot reach: a file
crossing a real file input, a canvas click landing on the room the geometry says it should,
and undo behaving like one step after a gesture that emitted a command per pointer move.

### Plan workflow

| # | Scenario | Assertion |
| --- | --- | --- |
| P1 | Import | A PNG through the real file input shows its name and pixel size |
| P2 | Uncalibrated | An imported plan raises `plan-uncalibrated-warning` and offers "Set scale — required" |
| P3 | No GREEN uncalibrated | `result-badge-GREEN` never appears while the plan has no mapping |
| P4 | Two-point calibration | Two canvas picks plus a typed distance produce a mm/px figure and clear the warning |
| P5 | Refusal | Two identical picks raise `plan-error` and leave the level uncalibrated |
| P6 | Re-import | Importing a second drawing discards the first one's calibration |

P3 is weak today and worth saying so: no rule in `standards/rules/dialysis/` is verified and
no equipment field group is cited, so no GREEN is reachable whatever the plan status. The gate
itself is proved in `evaluators/boundary.test.ts` against verified fixtures. P3 becomes
load-bearing the moment both sides of one finding are sourced.

### Rooms

| # | Scenario | Assertion |
| --- | --- | --- |
| R1 | Trace | Four clicks and Enter produce one room with an area in m² |
| R2 | Degenerate | Two points produce no room |
| R3 | Escape | A half-traced room is abandoned |
| R4 | Rename | Name is free text; function is a controlled dropdown |
| R5 | Containment | A machine inside a traced room reports "is inside" |
| R6 | Outside | A machine outside every room reports RED |
| R7 | Room deletion | Deleting a room leaves its machines on the drawing |

### Undo

| # | Scenario | Assertion |
| --- | --- | --- |
| U1 | Placement | Ctrl+Z removes it, Shift+Ctrl+Z restores it |
| U2 | **One drag, one step** | After a 12-move drag, one undo returns the footprint to its starting pixel |
| U3 | Room | One undo removes the room *and* its outline |
| U4 | One rename, one step | A whole typed name undoes in one step, and the room survives |
| U5 | Rotation | `]` turns a 900 × 750 footprint so it draws 750 wide; one undo turns it back |
| U6 | Text fields | Ctrl+Z inside an input leaves the document alone |

U2 is the one worth reading the code of. Two bugs were found writing it, both of which
would have left a green test proving nothing:

1. **It first measured the status bar's cursor readout, not the machine.** The cursor
   position depends only on the pointer and the viewport, so the assertion held whatever
   undo did. Now it scans the canvas for the equipment fill.
2. **It then raced the repaint.** Reading a canvas straight after an input event measures
   the previous frame. `expect.poll` retries; a bare `page.evaluate` does not.

It was then verified by temporarily disabling coalescing and confirming the failure —
252 px off. A test that has never failed is not known to work.

## 6. Save and open (Sprint 4)

| # | Scenario | Assertion |
| --- | --- | --- |
| S1 | Round trip | Save, start a new project, reopen the file — rooms, names and machines return |
| S2 | Rejection | A JSON file that is not a project raises `project-error` |

## 7. Origin, vertices, obstructions and levels (Phase 4.5)

`tests/e2e/uxCompletion.spec.ts`, 22 specs. All four items are gestures, and a gesture is
the one thing a unit test cannot speak to: whether a handle is grabbable, whether a
midpoint click inserts where the engineer aimed, whether switching floors leaves the
previous floor's selection describing something invisible.

### Origin placement

| # | Scenario | Assertion |
| --- | --- | --- |
| O1 | Gated | The control does not exist until a scale is set |
| O2 | Renumber | The picked point reads 0 mm afterwards; it read a real distance before |
| O3 | **Layout stays put** | The machine's drawn footprint does not move — re-datuming without translating would slide the plan out from under everything on it |
| O4 | Undo | Ctrl+Z restores the previous origin *and* the view |
| O5 | Escape | Cancels without changing anything |

O2 samples **off-centre** deliberately. The view opens with model (0, 0) at the middle of
the canvas, so a reading taken there would be zero before and after, and the assertion
would have held whatever the command did — the first version of this spec did exactly that.

### Vertex editing

| # | Scenario | Assertion |
| --- | --- | --- |
| E1 | Drag | Dragging a corner changes the room's area |
| E2 | One drag, one step | A 10-move drag undoes in one step |
| E3 | Insert | Clicking an edge midpoint takes the ring from 4 vertices to 5 |
| E4 | Delete, and the floor | Delete removes the selected vertex; at three it refuses |
| E5 | **Snap** | A corner dragged near a neighbouring room's corner lands on it **exactly** — checked in the saved document, because "exactly" is a claim about coordinates and only the file settles it |

These specs turn snapping **off** first. The grid step at the opening zoom is about a metre
— 70 screen pixels — so a traced corner lands up to half a step from where it was clicked,
far outside the 9 px grab radius. That is correct behaviour and a spec that ignored it
would be testing the grid, not the handle.

### Obstructions

| # | Scenario | Assertion |
| --- | --- | --- |
| B1 | Trace | A column appears in the obstruction list and the status bar count |
| B2 | Not a room | Tracing an obstruction creates no room record |
| B3 | Describe | Label and type both editable; type is a controlled dropdown |
| B4 | Next one | The type chosen for the next obstruction is remembered |
| B5 | **Evaluated** | A machine standing on a traced column reports RED |
| B6 | Undo | One undo removes the obstruction |

B5 is the one that matters. Obstruction *evaluation* shipped in Sprint 4 with the boundary
evaluator; Phase 4.5 added only the means to draw one. B5 is the spec that proves the two
meet.

### Levels

| # | Scenario | Assertion |
| --- | --- | --- |
| L1 | Add and switch | A new floor is empty; the machine is still on the one it was placed on |
| L2 | Rename | Reflected in the selector and the status bar |
| L3 | Floor | The only level cannot be deleted |
| L4 | **Delete and undo** | A floor holding a machine is deleted whole and comes back whole |
| L5 | Isolation | Each level's rooms and plan stay its own |
| L6 | Round trip | Two levels survive a save and reopen |

## 8. The report (Sprint 5)

`tests/e2e/report.spec.ts`. Twelve specs — R1–R11 from
[../architecture/REPORT_ENGINE_DESIGN.md](../architecture/REPORT_ENGINE_DESIGN.md), plus the
refusal path.

| # | Scenario | Assertion |
| --- | --- | --- |
| R1 | Preview | Every one of the nine sections plus provenance is present |
| R2 | Empty project | Verdict is 판정 불가 / Inconclusive, and the summary says why |
| R3 | A finding | Reaches the validation table with its `RC-nnn` code, and becomes a checklist item |
| R4 | Download | A file whose first five bytes are `%PDF-`, over 10 kB |
| R5 | Two levels | Two floor-plan sections and two validation sections |
| R6 | No drawing | The uncalibrated warning is **absent** — a level with no plan has exact geometry |
| R7 | Schedule | 585 × 620 × 1305 mm and 800 × 800 mm as distinct values |
| R8 | Datasheet | Three blocks apart; the footprint labelled a planning decision, not draft data |
| R9 | Bilingual | Every section title in Korean and English |
| R10 | Notice | The liability statement, both languages, on an empty report |
| R11 | **Hangul in the PDF text layer** | The downloaded PDF is parsed with pdf.js and 종합 요약, 최종 설치 승인 and Executive Summary are read back out |
| — | Refusal | A character the font cannot draw produces a visible error, not a blank box |

**R11 is the load-bearing one.** Everything before it could pass with a font that renders blank
boxes: `FontFile2` and `ToUnicode` being present prove a font was embedded, and only extraction
proves the glyphs are *mapped*. The PDF is parsed in Node rather than in the page, because
pushing a PDF reader into the application to satisfy a test would be the wrong way round.

**R6 was written expecting the warning and found a defect instead.** The report was marking the
default project — no drawing at all — as uncalibrated. A level with no plan is not uncalibrated;
its geometry is exact. The model now carries three plan states, and the spec asserts the absence.

## 9. Platform (web-first decision)

`tests/e2e/platform.spec.ts`, 8 specs. Owner decision: web-native, desktop primary, tablet
secondary, installable as a PWA, one codebase across Chrome, Edge and Safari.

| # | Scenario | Assertion |
| --- | --- | --- |
| W1 | Manifest | Served, `display: standalone`, 192/512 plus a maskable icon, **and every icon resolves and is a real PNG** |
| W2 | iPadOS | `apple-touch-icon` and the `apple-mobile-web-app-*` meta tags — Safari ignores the manifest for home-screen installs |
| W3 | Service worker policy | Hashed assets cache-first, navigations network-first, GET and same-origin only, and **exactly two** response paths |
| W4 | No service worker | The whole workflow, report included, with every registration removed |
| W5 | No desktop-only API | No Electron bridge; the save path does not need the File System Access API |
| W6 | Tablet layout | No horizontal page scroll at 1024 × 768 |
| W7 | Tablet touch | A tap places equipment — pointer events, no touch-specific code path |
| W8 | Tablet pinch | A two-finger spread zooms in. **Verified by disabling the handler** — the spec failed as it should |

**W3's assertion is a count.** Two `respondWith` branches means nothing else is cached; a third is
a new caching policy that has to be a deliberate edit to the test rather than a line somebody added.
The first version of this spec asserted the absence of the string `.mfd.json` and failed — on the
comment in `sw.js` explaining that project files are never cached.

**One behaviour is deliberately not automated.** "A second finger must not drag the machine the
first one landed on" is implemented, and the spec for it **passed with the pinch handler disabled** —
CDP touch injection cannot reproduce a real two-finger sequence closely enough to distinguish the
cases. It was removed rather than kept, because a green test that cannot fail reports coverage that
does not exist. Recorded in
[../architecture/PLATFORM_SUPPORT.md](../architecture/PLATFORM_SUPPORT.md) § E.

**Safari and Edge are not executed.** This suite is Chromium. They are covered by the browser
baseline and by using no engine-specific API, which is a weaker guarantee and is stated as one.

## 10. Screenshot validation

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
| `field-<label>` | A status bar value. Label and value are separated by a CSS gap, so the DOM text runs them together as "Placed1"; the value carries its own hook rather than making assertions depend on spacing. |
| `catalog-item-<id>` | A catalogue palette entry |
| `draft-badge` | Draft marking in the palette |
| `draft-placement-warning` | Status bar draft warning |
| `validation-panel` | Findings panel |
| `validation-result` | One finding, carrying `data-level` |
| `result-badge-<LEVEL>` | GREEN / YELLOW / RED badge |
| `provisional-warning` | Panel-wide provisional banner |
| `findings-summary` | Status bar RED / YELLOW counts |
| `plan-file-input` | Hidden file input for the floor plan |
| `import-plan` · `calibrate` · `recalibrate` | Plan workflow buttons |
| `calibration-distance` · `calibration-apply` | Scale entry |
| `plan-error` | Plan import or calibration failure |
| `plan-uncalibrated-warning` | Status bar warning that the drawing has no mapping |
| `space-list` | The rooms on this level |
| `space-name` · `space-function` · `delete-space` | Room inspector |
| `project-file-input` · `open-project` · `save-project` · `new-project` | File operations |
| `project-error` | Save or open failure |
| `project-name` | Title bar project name |
| `set-origin` | Start the origin pick |
| `space-vertex-count` · `obstruction-vertex-count` | Vertex count and the editing hint. Two hooks, because the room inspector and the obstruction inspector each describe only their own — one panel reporting the other's boundary was a real defect found writing these specs |
| `obstruction-list` · `obstruction-label` · `obstruction-type` · `delete-obstruction` | Obstruction inspector |
| `draft-obstruction-type` | The type the next traced obstruction gets |
| `level-select` · `level-name` · `add-level` · `delete-level` | Level panel |
