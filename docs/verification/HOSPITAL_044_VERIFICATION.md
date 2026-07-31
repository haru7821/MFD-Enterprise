# Hospital_044 — first end-to-end drawing verification

> Owner decision:
> *"Proceed with Hospital_044 as the first end-to-end verification drawing. Verification goals: 1.
> Import the original PDF. 2. Calibrate using the drawing dimension lines as the primary method. 3.
> Compare with the printed scale only as a secondary cross-check. 4. Verify coordinate mapping using
> real measurements. 5. Place AK98 equipment (planning footprint 800 × 800 mm) and 1000 × 2100 mm
> beds. 6. Run the rule engine, optimiser and planning workflow. 7. Generate the final report.*
>
> *Record every measured value as an observation with its source and SHA-256 of the drawing. Do not
> invent any measurement. If any discrepancy is found between the drawing, calibration, optimisation
> and report, stop and report it before fixing it."*

**Result: the seven goals are met. Three discrepancies were found and reported before anything was
changed.** One is in the drawing, one is a value the drawing does not carry, and one was a defect in
this repository's own geometry code that a real layout exposed.

The owner has since ruled on all three: **VD-1 and VD-4 approved exactly as implemented**, and
**VD-5 fixed** by a decision on containment semantics — §5 carries the ruling and §5a the result of
re-running the verification against it. The two approved discrepancies remain in
`knowledge/verification/Hospital_044-dialysis.json` with `resolved: false`, because neither is a
thing to fix: one is a question for whoever holds the CAD file, and the other is the drawing not
stating something.

| | |
| --- | --- |
| Drawing | `Hospital_044/dialysis.pdf` — 지상2층 평면도, 화전리123번지병원 |
| SHA-256 | `4e795d5bb5e8c038b43c84828f9a1233660a466cd77d5e59056796b3466032d4` |
| Sheet | A3 portrait, 841.92 × 1190.52 pt. Title block claims A3 — **it agrees** |
| Printed scale | `SCALE : 1 / 100`, `A3 : 1/100`, dated 2022.07.16 |
| Producer | Microsoft Print To PDF, from a CAD model. Vector, not a scan |
| Record | `knowledge/verification/Hospital_044-dialysis.json` |
| Harness | `pnpm verify:drawing` — `scripts/verify-drawing.ts` |
| Browser | `tests/e2e/hospital044.spec.ts`, skipped where the dataset is absent |

---

## 1 · How the drawing was read

The importer rasterises a PDF and never reads its vector content; that is the owner's Sprint 4 scope
and nothing here changes it. The verification needs something stronger than a person's eye, so
`scripts/lib/pdfGeometry.ts` reads the page's paths and text directly and
`packages/layout-knowledge/src/dimensions.ts` pairs each printed dimension with the line it labels.

**This is an instrument, not a feature.** Production calibrates from where a person clicked;
verification calibrates from what the file says, and the difference between the two is the number
worth reporting.

Two things about that reader are load-bearing, and both were found by getting them wrong first.

**The drawn line is not the measurement.** A CAD dimension line stops short of each tick by the
tick's width — about 3.6 pt on this sheet. Measuring the line rather than the ticks produces an error
that is 0.7 % on the 499 pt overall dimension and 6 % on the 57 pt bed pitch: invisible on the
dimension you calibrate from, largest on the ones you care about. The reader measures between the
**measure points**, where the perpendicular members of the dimension layer meet the line.

**A label belongs to the shortest line it sits on.** Preferring the longest paired a `2200` room
note on the companion sheet with a chained dimension line running beneath it, and reported an 11.6 m
measurement. That case now reads as unread rather than wrong.

---

## 2 · The dimensions, and the scale they agree on

Seven dimensions are printed and all seven were read. Six agree on one scale to within ±0.06 %.

| Label | Measured | Implies | |
| --- | ---: | --- | --- |
| `17,600` | 498.763 pt | 1 : 100.03 | **primary** — calibrated from |
| `4,900` | 138.865 pt | 1 : 100.02 | consistent |
| `4,500` | 127.482 pt | 1 : 100.06 | consistent |
| `2,600` | 73.684 pt | 1 : 100.02 | consistent |
| `2,500` | 70.883 pt | 1 : 99.98 | consistent |
| `2,000` | 56.680 pt | 1 : 100.02 | consistent — the bed pitch (`베드 간격`) |
| `3000` | 87.661 pt | **1 : 97.01** | **inconsistent** — see §5, VD-1 |

The agreed scale is the **median**, 1 : 100.02, not the mean. A mean would be dragged towards the
outlier and the outlier would then look less anomalous for having dragged it.

The primary is the longest of the consistent set, and that is enforced rather than assumed
(`primaryDimensionIsSound`). Calibrating from `2,000` instead of `17,600` would multiply whatever
error there is in locating two points by a factor of nine.

**The same seven readings were taken independently from the companion sheet** `ro_room.pdf` — the
same floor plan plotted by a different program (pdfplot, landscape) — which agrees dimension for
dimension and flags the same single outlier. Two producers, two page orientations, one answer.

---

## 3 · Calibration, cross-check, and the mapping test

**Primary — dimension line.** Two-point calibration from the `17,600` mm dimension's own measure
points, at the resolution the importer will use for this page (150 dpi, no cap: 1754 × 2480 px).

```
17,600 mm ÷ 1039.09 px = 16.93791 mm/px
```

**Secondary — printed scale.** `1:100` at 150 dpi is `25.4 / 150 × 100 = 16.93333 mm/px`.

```
16.93791 / 16.93333 − 1 = +0.027 %
```

The two independent routes agree to **twenty-seven parts in a hundred thousand**. The printed scale
was run only as a cross-check, and it was permitted to run at all only because the title block's
claimed A3 matches the page's actual A3 — on three of the six sheets in the corpus that name a paper
size it does not, and the calibration safety rule refuses the route outright there.

**Goal 4 — the mapping verified against real measurements.** The mapping was built from one
dimension. Every *other* printed dimension is then a distance it has to reproduce without having been
shown it:

| Dimension | Mapping says | Off by |
| --- | ---: | ---: |
| `4,900` | 4,900.2 mm | +0.004 % |
| `4,500` | 4,498.5 mm | −0.033 % |
| `2,600` | 2,600.1 mm | +0.004 % |
| `2,500` | 2,501.3 mm | +0.050 % |
| `2,000` | 2,000.1 mm | +0.004 % |

Worst case 1.3 mm on a 2.5 m dimension. Over the 17.6 m hall that bound is about 9 mm.

The drawing is plotted about 9° off the sheet, so the mapping also carries a rotation
(`coordinateMapping.rotation`) to square it. Without that step every clearance would be measured 9°
out. Noted in passing: `radiansToMillidegrees` in `@mfd/cad-engine` rounds to whole degrees, which
on a hall this long would leave about 84 mm of skew — the harness sets exact millidegrees, and
whether the interface should is a separate question.

---

## 4 · The room, the equipment, and the engines

**Length 17,600 mm** — printed. **Width 7,402 mm** — *not printed anywhere on the sheet.*

The hall's width was measured between the inner faces of its two walls on a cross-section at
mid-hall, against the scale established above. Walls are identified as **same-colour parallel pairs
at plausible wall thickness** — 200 mm and 199 mm here — and the outermost such pair on each side
bounds the room. Same-colour matters: the sheet has a grey setting-out line and a red grid line
201 mm apart that would otherwise read as a wall that is not there. Outermost matters: the bed frames
are drawn 202 mm across and are a plausible wall pair by every local test.

The independent check is the title block's own area figure: 27,000 mm (17,600 + 4,500 + 4,900) ×
7,402 mm = 199.8 m² against a stated **201.1 m²**, 0.6 % apart on a plan that is not a true rectangle.

That measurement is recorded as `calibrated_measurement`, never `dimension_line`, and a printed
dimension would supersede it. It is discrepancy VD-4, not a footnote.

**Placement.** Ten stations in two rows of five facing each other, at the drawing's own 2,000 mm
pitch — the arrangement the drawing shows. AK98 at its **800 × 800 mm planning footprint**; beds at
**1,000 × 2,100 mm**. The AK98's manufacturer width is 345 mm and is used nowhere in any geometry;
that separation is asserted by test.

**Engines.**

| Stage | Result |
| --- | --- |
| Rule engine | **0 RED · 60 YELLOW · 0 GREEN** — reason codes `RC-110`, `RC-202`, `RC-321` |
| Optimiser | 3 ranked proposals for 10 stations |
| Installation planner | 6 stages, 2 blockers |
| Report | `inconclusive`, report version 2, 164,367 bytes of PDF |

**0 GREEN is correct and is not a failure.** Every rule in `standards/rules/dialysis` is still
`status: draft`, and a draft rule cannot certify a pass (AD-6a). The 60 YELLOW are 40 clearance
findings that say *threshold unknown* — the AK98's service clearances are uncited, which is open
question A-1 — plus 10 collision passes and 10 containment passes, all downgraded for the same
reason. That is the system reporting the state of its evidence, exactly as designed, and
`inconclusive` is the honest verdict for a layout no sourced rule has been able to judge.

The figures above are **after** the VD-5 fix. The first run reported 10 RED, 50 YELLOW, 12 plan
blockers and a verdict of `not_acceptable`; every one of those REDs was the containment defect. See
§5a.

---

## 5 · The three discrepancies — reported before anything was changed

### VD-1 · The `3000` label disagrees with the line beneath it — **approved as implemented**

The label states 3,000 mm. Its geometry measures **3,093 mm** at the sheet's own scale — 3.01 % out,
where every other dimension on the sheet is within 0.06 %.

Two things point at a manual text override in the CAD file. It is the only dimension on the sheet
written **without a thousands separator** (`3000`, against `2,000` and `4,500`). And the same
disagreement, at the same magnitude, appears independently on the companion sheet plotted by a
different program — so it is in the model, not in the plotting.

**Not corrected, and excluded from everything.** It is not in the calibration, not in the mapping
checks, and not in the knowledge base. A dimension text that disagrees with its own geometry is a
question for whoever holds the CAD file, and a knowledge base is where a wrong number does the most
quiet damage.

### VD-2 · not raised

The calibrated and printed scales agree to 0.027 %, well inside the 1 % tolerance.

### VD-3 · not raised

The title block claims A3 and the page is A3.

### VD-4 · The hall's width is not on the drawing — **approved as implemented**

The pipeline needs it; the sheet does not state it. Rather than assume one, it is measured against
the established scale and carries the weaker method wherever it appears — §4 above, and
`knowledge/observations/hospital-044-verification.json` where it is recorded with a stated
uncertainty of about ±4 mm.

This is the owner's *"Dimension line이 없으면 measurement unavailable 표시"* honoured in the only
way that lets the work continue: the value is used, and it never stops saying what it is.

### VD-5 · Equipment flush against a wall was reported as outside the room — **fixed**

**This was a defect in `@mfd/cad-engine`, found by a real layout, and it was the reason the first
run's report said `not_acceptable`.**

All ten RED findings said a machine *extends beyond the room outline* while **every corner of that
machine's footprint was inside the outline**. The harness recomputes that containment itself and
recorded the contradiction rather than writing a false RED into the record as an engineering result.

The cause was precise. `polygonContainsPolygon` required that no edge of either polygon met the
other. A machine standing against a wall has two footprint edges whose **endpoints land on the
interior of a room edge** — a T-junction. `segmentIntersectionPoint` reported that touch as a proper
crossing, so containment was refused:

```
room bottom (0,0)–(17600,0)  ×  machine bottom (1000,0)–(1800,0)   → null   (collinear, correct)
room bottom (0,0)–(17600,0)  ×  machine left   (1000,800)–(1000,0) → (1000,0)   ← the false crossing
```

`polygonContains` had always counted a point on the outline as inside — its own comment says a
machine flush against a wall is in the room — so the polygon-level test contradicted the point-level
one. It had never shown up because every test room until then was traced with clearance around its
equipment.

#### The owner's ruling

> *"A footprint touching the room boundary is considered contained. Only geometry extending outside
> the boundary is a containment failure. Treat boundary contact as topological contact, not as a
> crossing. Clearance evaluation remains completely separate from containment evaluation. Update
> polygonContainsPolygon and its tests accordingly."*

Implemented. `polygonContainsPolygon` now asks three questions, and geometry outside the room fails
any one of them:

1. **Every vertex of the footprint is inside the room**, on the outline included — unchanged.
2. **No edge crosses another transversally.** The new predicate `segmentsProperlyCross` returns
   false when the meeting point coincides with any endpoint of either segment, which covers shared
   endpoints, collinear overlap and — the case this is for — T-junctions. Contact is measured as a
   distance from the endpoints rather than as a tolerance on parametric position: a parametric
   epsilon would mean one thing on an 800 mm footprint edge and something twenty times larger on a
   17 m wall, for the same millimetre of geometry.
3. **No vertex of the room is strictly inside the footprint.** The case the first two can both miss:
   a notch swallowed whole, its edges leaving the footprint exactly through the footprint's own
   corners, so every meeting is an endpoint and no crossing is transversal. On the outline is not
   strictly inside, so a machine filling its room exactly still passes.

**Clearance is untouched, and was already structurally separate:** `evaluateClearance` is handed
`{ placements, catalog }` and never the boundaries, so it cannot read a room outline however
containment is written. Two tests in `boundary.test.ts` now hold the consequence — that every
clearance finding is identical whether a room is drawn or not, and that containment is answered
without consulting a clearance threshold.

Whether a machine against a wall has room to be *serviced* remains a clearance question, answered
against thresholds with documents behind them. Containment answers "is it in the room".

---

## 5a · The verification re-run against the fix

Re-ran `pnpm verify:drawing`. **The ten RED containment findings are gone; nothing else moved.**

| | Before | After |
| --- | --- | --- |
| RED | 10 | **0** |
| YELLOW | 50 | 60 |
| GREEN | 0 | 0 |
| Reason codes | `RC-110`, `RC-202`, `RC-302` | `RC-110`, `RC-202`, **`RC-321`** |
| Optimiser | 3 proposals, 10 stations | *unchanged* |
| Plan blockers | 12 | 2 |
| Report verdict | `not_acceptable` | `inconclusive` |

The ten `RC-302` *"extends beyond room"* findings became ten `RC-321` *"inside room, clears every
obstruction"* — a pass, downgraded to YELLOW because the boundary rule is still `draft`, not because
anything is wrong with the layout. The plan's blockers fell from 12 to 2 because ten of them were
open RED findings that should never have existed.

**Nothing about the drawing changed, and nothing was allowed to.** Verified by diff rather than
asserted:

- `knowledge/observations/hospital-044-verification.json` — **byte-identical**.
- The record's `calibration`, `dimensions`, `crossCheck` and `mappingChecks` — **byte-identical**.
- `pipeline.room` and `pipeline.placements` — unchanged.
- `discrepancies` — VD-1 and VD-4 remain, unresolved. VD-5 is absent because the run no longer finds
  it: the harness's self-check looks for findings that contradict their own geometry, and there are
  none.

#### Genuine violations still fire, on this drawing

A fix that merely switched containment off would produce the same headline. Re-run against the same
room and the same ten stations with a fault introduced:

| Layout | Result |
| --- | --- |
| As placed | 0 RED |
| One machine 1 mm through the wall | **1 RED — `RC-301`**, extends beyond room, with the overhang measured |
| One machine moved onto its neighbour | **2 RED — `RC-201`** on both machines |

Contact is contained; one millimetre of crossing is not. The unit suite holds the same boundary from
the other side: a machine flush on a wall, wedged in a corner, and exactly filling its room all pass;
a machine one millimetre over, one spanning a C-shaped room's mouth, and one swallowing a notch all
fail. Each of those guards was verified by breaking the implementation and watching the right test
go red — including the third check, whose first test turned out to be caught by the crossing rule
instead, so a case that genuinely needs it was constructed.

---

## 6 · What entered the knowledge base

Two readings, and the difference between them is the point.

| Value | Method | Confidence |
| --- | --- | --- |
| `station_pitch` 2,000 mm, hemodialysis treatment | `dimension_line` | high — the drawing states it, and its geometry agrees to 0.004 % |
| `treatment_room_width` 7,402 mm, hemodialysis treatment | `calibrated_measurement` | medium — nothing on the drawing states it |

`treatment_room_width` is new to `DIMENSION_NAMES`. It decides whether a hall can hold two facing
rows or only one, so it is worth carrying across drawings — and it is precisely the dimension this
hall did not print.

Both carry the drawing's SHA-256 and an observer of `{ type: "ai", name: "MFD Drawing Verification
Harness", version: "1.0" }`. Neither is a requirement: `standards/` is normative, `knowledge/` is
descriptive, and `boundaries.test.ts` keeps the rule engine unable to read this package at all.

The `3000` dimension contributed nothing.

---

## 7 · What CI can and cannot check

The drawing is a hospital's property and is not in this repository, so **CI cannot re-measure
anything**. It checks the record instead, and the record is built so that checking it is worth
something: every figure is derived from the others.

`packages/layout-knowledge/src/verification.test.ts` re-derives the calibration from the two recorded
points, re-derives each mapping check from that calibration, re-derives the cross-check from the
render resolution, and re-derives `agrees` from the deviation. It also asserts the record carries no
drawing content, that no discrepancy is marked resolved, and that the planning footprints are the
owner's 800 × 800 and 1,000 × 2,100.

Each of those guards was verified by breaking the record and watching it fail — nudging the scale by
0.1 %, marking a discrepancy resolved, calibrating from a shorter dimension, claiming agreement that
was not there, and deleting the discrepancy that names the outlier. All five were caught.

`tests/e2e/hospital044.spec.ts` closes the last gap where the dataset is available: the real 1 MB PDF
through the real importer, arriving at the pixel size, sheet size and millimetres per pixel the
record predicts, then equipment, verdict and a downloaded PDF.

---

## 8 · The corpus sweep — a negative result

> Owner decision: *"After Hospital_044 passes, use the remaining PDF drawings to expand the
> knowledge base automatically."*

Done, as `pnpm verify:sweep` (`scripts/sweep-drawings.ts`). **It adds nothing to the knowledge base,
and the reason it adds nothing is the result.**

### Coverage

| | Sheets |
| --- | ---: |
| Catalogued | 300 |
| Not a PDF (DWG) | 146 |
| Scanned — no vector content to read | 65 |
| Vector CAD exports, attempted | 89 |
| — fewer than two readable dimensions | 58 |
| — too few dimensions agree to trust the scale | 16 |
| — not a dialysis layout | 1 |
| — width outside a plausible band | 8 |
| **Reached a measurement** | **5** (+ Hospital_044) |

Of the sheets that reached a measurement, **one** states a scale in readable text that corroborates
the geometry. The other thirteen state none: their title blocks are plotted as geometry rather than
as text, so the printed-scale cross-check that worked on Hospital_044 is not available at corpus
scale. It is applied as a refusal where a scale *is* readable, never as a requirement — requiring it
measured nothing at all.

### Why the measurement does not generalise

`measureRoomWidth` takes the outermost same-colour wall pair on each side of a cross-section. On
Hospital_044 that is the treatment hall's own walls, because the hall spans the building's full
width — and the answer checks out against the title block's area figure to 0.6 %.

Where the treatment room is **one room among several across the section**, the outermost pair is the
building's exterior wall. The same arithmetic then returns a real distance across the wrong thing:

```
Hospital_008/dialysis_typeA.pdf         12,698 mm
Hospital_023/dialysis_typeB_30bed.pdf   14,200 mm
Hospital_033/dialysis_rev04.pdf         12,798 mm
Hospital_025/dialysis_typeC.pdf         11,254 mm
Hospital_035/dialysis_typeA_16bed_2.pdf  5,305 mm
```

A median of 12.7 m for a quantity that is 7.4 m on the one sheet where it is known to be right.
These are building widths wearing a treatment-room label. Nothing in the geometry distinguishes the
two cases; telling them apart needs to know *which* walls bound the treatment room, and that is room
identification — a feature this product does not have and was not asked for.

So the sweep computes the figure, prints it as a diagnostic, and **writes no observation**. Four
confident wrong numbers in a knowledge base are worse than an empty one, and the numbers would have
been indistinguishable from the correct one once aggregated.

### What the sweep does establish

Two sheets in the whole corpus carry a dimension whose text disagrees with the geometry beneath it
by a margin a draftsman's override can explain:

| Sheet | Label | Sheet scale | Implied | Out by |
| --- | --- | --- | --- | ---: |
| `Hospital_044/ro_room.pdf` | `3000` | 1 : 100.01 | 1 : 97.14 | −2.9 % |
| `Hospital_025/dialysis_typeA.pdf` | `1,950` | 1 : 79.22 | 1 : 80.25 | +1.3 % |

The first is VD-1 arriving independently on the companion sheet, which is what makes it a fact about
the CAD model rather than about one plot.

A further six labels are reported *an order of magnitude* out. Those are not drawings disagreeing
with themselves — they are this reader pairing a label with the wrong line, and they are counted
separately and claimed as nothing. Reporting the two kinds together would make both useless.

### Before a sweep is worth running again

1. **Room identification.** Without it, no across-the-room measurement generalises past a hall that
   happens to span its building.
2. **The 58 sheets with fewer than two readable dimensions** are worth a look: some may be reader
   failures rather than undimensioned drawings, and each one recovered is a sheet that becomes
   measurable.
