# Automatic room understanding — deterministic feasibility

> Owner direction: *"The next engineering milestone is automatic room understanding. Priority: 1.
> Dialysis room detection · 2. Boundary extraction · 3. Door detection · 4. Wall classification ·
> 5. Room connectivity · 6. Object recognition (bed, nurse station, sink, RO room, drain, electrical
> panel). Do not implement machine-learning models unless deterministic approaches have been
> exhausted first."*

Exhausting deterministic approaches means running them and reporting what they do. This is that
work, done before any of the six is implemented, because it changed what should be built.

**Headline: the geometry-first order in the priority list is the wrong order for this corpus, and
one measurement shows why.** The dialysis room on a real drawing is frequently **not a topologically
enclosed region** — it is walled on two sides and open to circulation at its ends. No amount of wall
classification or region finding bounds a room that has no geometric boundary to find. What most
sheets carry instead is their room names, in text, with positions — twelve of fourteen, which is far
ahead of every geometric signal and still short of universal.

Run it: `pnpm study:rooms` — `scripts/study-room-signals.ts`.

---

## 1 · What was measured

Four candidate signals, over every sheet that gets far enough through the validation programme to
have a trustworthy scale. That is **fourteen sheets**.

An earlier version of this study reported six. It additionally required the cross-section
measurement to have already succeeded, which excluded the sheets that stop at the `room` stage —
precisely the population this milestone exists for. Those eight sheets have **no reference to score
against**, and that is now reported rather than worked around.

| Signal | Idea | Would give |
| --- | --- | --- |
| Wall pairs | Two parallel same-colour lines a wall's thickness apart | Priority 4 — wall classification |
| Free-space fill | Flood the space between barriers from a point inside the room | Priority 2 — boundary extraction |
| Erosion sweep | Erode the free space until narrow necks sever, then fill | Priority 3 — separation at doorways |
| Room labels | Text runs naming a room, and where they sit | Priority 1 — which region is which |

## 2 · Results

The run's output, **unedited** — including the `ref` column, which is the reference the first three
signals are scored against and which is `none` on eight sheets. An earlier draft of this document
deleted that column. It is the column that shows what the scoring rests on, and removing it made the
signals look better tested than they are.

```
Hospital_008/dialysis_typeA.pdf            ref 3.9×12.7 m  pairs  330!  fill 1.1×0.8  erosion none  labels 5
Hospital_022/dialysis_typeB.pdf            ref none          pairs  377!  fill 30.1×16.9  erosion none  labels 7
Hospital_023/dialysis_typeB_30bed.pdf      ref 15.6×14.2 m  pairs  174!  fill 12.4×0.4  erosion none  labels 5
Hospital_025/dialysis_typeA.pdf            ref none          pairs  185!  fill 5.8×2.6  erosion none  labels 3
Hospital_025/dialysis_typeB.pdf            ref none          pairs  327!  fill 15.3×20.6  erosion none  labels 4
Hospital_025/dialysis_typeC.pdf            ref 4.9×11.3 m  pairs  106!  fill seed blocked  erosion none  labels 4
Hospital_028/dialysis_typeA.pdf            ref none          pairs   67!  fill 11.1×12.5  erosion none  labels 0
Hospital_033/dialysis_rev01.pdf            ref none          pairs  132!  fill 39.2×12.7  erosion none  labels 8
Hospital_033/dialysis_rev03.pdf            ref none          pairs  160!  fill 39.2×12.7  erosion none  labels 9
Hospital_033/dialysis_rev04.pdf            ref 14.8×12.8 m  pairs  139!  fill 39.2×12.7  erosion none  labels 7
Hospital_035/dialysis_typeA_16bed_2.pdf    ref 4.1×5.3 m  pairs  239!  fill 4.0×5.2 ✓  erosion 0 mm ✓  labels 5
Hospital_039/dialysis_18bed_rev01.pdf      ref none          pairs  181!  fill 4.5×10.4  erosion none  labels 4
Hospital_044/dialysis.pdf                  ref 17.6×7.4 m  pairs  336!  fill 27.5×8.6  erosion none  labels 5
Hospital_045/dialysis_typeA_2.pdf          ref none          pairs  998!  fill 1.1×0.7  erosion none  labels 0

sheets attempted: 14
  of which no reference to score against          8
  wall-pair count small enough to be a room's walls  0
  free-space fill lands within 10 % of the room      1
  some erosion radius lands within 10 % of the room  1
  sheet carries at least one room-name label         12
```

| Signal | Worked | Out of |
| --- | ---: | --- |
| Wall pairs | **0** | 14 |
| Free-space fill | **1** | 6 scorable |
| Erosion sweep | **1** | 6 scorable |
| Room labels | **12** | 14 |

### Wall pairs — 0 of 14

Between 67 and 998 pairs per sheet. The rule that works on a *single cross-section* — take the
outermost same-colour pair at plausible wall thickness — matches furniture, ceiling grids and
setting-out lines everywhere when applied to a whole sheet. Hospital_044's bed frames are drawn
202 mm apart and are a textbook wall by every local test.

The cross-section version survives because "outermost on this line" is a strong extra constraint.
There is no whole-sheet equivalent of it.

### Free-space fill — 1 of 6 scorable

The failures are not near misses: 1.1 × 0.8 m (the seed landed inside a bed), 39.2 × 12.7 m (the
whole sheet, on three separate revisions of one hospital), 27.5 m across a 17.6 m hall. One seed
landed on a barrier. The single success needed no erosion at all, which means that room happened to
be fully enclosed — and its reference, 4.1 × 5.3 m, is one of the unverified ones.

### Erosion sweep — 1 of 6 scorable, and the finding is in the failure

Eroding free space severs necks narrower than twice the radius, which is the standard way to
separate rooms at their doorways. On Hospital_044 — the one sheet whose room *is* corroborated —
sweeping the radius:

| Erode | Along | Across |
| ---: | ---: | ---: |
| 0 mm | 27.50 m | 8.57 m |
| 180 mm | 27.13 m | 8.18 m |
| **300 mm** | 26.20 m | **7.45 m** ← the width is right |
| 420 mm | 25.96 m | 7.18 m |
| 540 mm | 21.38 m | 6.27 m ← now too narrow |
| 660 mm | 21.00 m | 6.03 m |

*(the hall is 17.60 m along × 7.40 m across)*

**There is no radius that isolates it.** At 300 mm the width is right to 0.7 % and the length is
still the whole 26 m building. By the time erosion bites on the length, the width has collapsed.

That is not a tuning problem. It is the drawing saying that this room's ends are **not doorways**:
the hall opens directly onto the circulation core, the way a ward opens onto a corridor. A doorway is
a 900 mm neck and erosion severs it; a room-width opening is not a neck at all.

This finding does not depend on the reference being right. It is a statement about how the free space
behaves under erosion, measured on the one sheet whose room is independently corroborated.

### Room labels — 12 of 14

Twelve sheets name their rooms in extractable text, with positions: `정수실`, `탈의실`, `창고`,
`물품실`, `폐기물`, `간호사실`, `휴게실`, `화장실`. Three to nine per sheet.

**Two carry none** — `Hospital_028/dialysis_typeA.pdf` and `Hospital_045/dialysis_typeA_2.pdf`. So
this is the strongest signal by a wide margin and it is *not* universal, which matters for what gets
built on it: a room finder anchored on labels needs an answer for the sheet that has none, and
"stop and say the room is unknown" has to be that answer rather than a fallback to a geometric guess
that this study shows does not work.

## 3 · What this changes

The priority list runs geometry-first — detect the room, extract its boundary, then find doors, walls
and connectivity — with recognition last. On this corpus that order cannot start: step 2 has nothing
to extract on four sheets in six, and step 4 is unusable on all six.

**The anchor has to come first, and the anchor is semantic.** Two candidates, both present in the
data and both citable:

1. **Room-name text.** On twelve of fourteen sheets. Names a room and locates it. The dialysis hall is often
   *unlabelled* — it is the large space the labelled rooms are arranged around — so its identity is
   partly *"the region none of the other labels falls in"*, which is still a deterministic statement
   about text positions.
2. **The station pattern.** Ten beds at a 2,000 mm pitch is what makes a dialysis room a dialysis
   room, and the pitch is printed on the drawing. A first attempt at finding it by looking for
   repeated congruent *segments* found the wall hatching instead — 750 mm runs at 1,500 mm pitch —
   so this needs assembled rectangles rather than raw segments, and it has not been tried yet.

Geometry then bounds outward *from* an anchor rather than being asked to find rooms unaided: given a
point known to be in the treatment area, the cross-section measurement already works and is already
verified to 0.6 % on Hospital_044 against its own area figure.

**Revised order, and the reason for each move:**

| | Step | Why here |
| --- | --- | --- |
| 1 | Room-name text extraction and placement | The only universal signal; needs no geometry |
| 2 | Station pattern detection (assembled rectangles) | The semantic anchor for *dialysis* specifically |
| 3 | Boundary extraction outward from an anchor | Has something to start from, unlike a bare fill |
| 4 | Door and opening detection | Now separable from "the room simply ends" |
| 5 | Wall classification | Tractable once a room is known; hopeless sheet-wide |
| 6 | Room connectivity, then object recognition | Unchanged |

**No machine learning is warranted yet, and this study is the argument.** Two of the four signals
failed for a reason that is understood and fixable by changing what they are anchored to, not by
learning a function. The third failed because a room-width opening is not a doorway, which a model
would have to be taught with labels nobody has. And the fourth — text — needs no model at all.

---

## 4 · Caveat on the reference

The `ref` column these signals are scored against is the validation pipeline's own room rectangle,
and **only Hospital_044's is corroborated** — against the title block's stated area, 199.8 m²
computed against 201.1 m² printed, by a person.

Both of its dimensions are inferences elsewhere:

- the **width** is the outermost same-colour wall pair on a cross-section, which is the room's own
  walls only where the room spans its building and the *building's* exterior wall otherwise;
- the **length** is the sheet's **longest printed dimension**, which is the room's length on
  Hospital_044 — where that dimension's extension lines do bound the hall — and something else
  entirely on sheets whose longest dimension is 3.9 m or 15.6 m.

The second of those was found by the standing review and is why the pipeline no longer accepts a
room without a person confirming it. It is also why the references above read `3.9 × 12.7 m` and
`4.9 × 11.3 m`: those are not rooms, and printing them is the point.

So this study says the four signals **disagree with each other and with the pipeline's rectangle**,
and says exactly how. It does not say any of them is wrong by a measured amount, because on thirteen
of fourteen sheets there is nothing yet to be wrong against. That is the same reason room
understanding is worth building: the corpus has no independent statement of where its rooms are.

## 5 · One change was made

`scripts/lib/pdfGeometry.ts` now flattens Bézier curves into short straight runs instead of
following them to their end point and dropping them. Curves are what door swings are drawn with, and
a swing plus its leaf closes the opening it spans — without them a region fill walks out of every
room through its door.

On Hospital_044 it changes nothing at all: that sheet contains no curves, its door swings are
polylines, and its dimensions and verification record are byte-identical afterwards. Across the
corpus one sheet moved from `extraction_error` to `insufficient_evidence`. It is kept because the
next sheet plotted by software that emits real curves would otherwise have its doors invisible, and
because it costs nothing where there are none.
