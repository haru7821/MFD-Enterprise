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
classification or region finding bounds a room that has no geometric boundary to find. What every
sheet does carry is its room names, in text, with positions.

Run it: `pnpm study:rooms` — `scripts/study-room-signals.ts`.

---

## 1 · What was measured

Four candidate signals, over every sheet that gets far enough through the validation programme to
have a trustworthy scale. That is **six sheets** — the same ceiling the corpus ledger reports, and a
small number for a reason: 211 of 306 drawing-pages are DWG or scans, and 80 more cannot establish a
scale at all.

| Signal | Idea | Would give |
| --- | --- | --- |
| Wall pairs | Two parallel same-colour lines a wall's thickness apart | Priority 4 — wall classification |
| Free-space fill | Flood the space between barriers from a point inside the room | Priority 2 — boundary extraction |
| Erosion sweep | Erode the free space until narrow necks sever, then fill | Priority 3 — separation at doorways |
| Room labels | Text runs naming a room, and where they sit | Priority 1 — which region is which |

## 2 · Results

```
Hospital_008/dialysis_typeA.pdf          pairs  330!  fill  1.1× 0.8   erosion none  labels 5
Hospital_023/dialysis_typeB_30bed.pdf    pairs  174!  fill 12.4× 0.4   erosion none  labels 5
Hospital_025/dialysis_typeC.pdf          pairs  106!  fill seed blocked erosion none  labels 4
Hospital_033/dialysis_rev04.pdf          pairs  139!  fill 39.2×12.7   erosion none  labels 7
Hospital_035/dialysis_typeA_16bed_2.pdf  pairs  239!  fill  4.0× 5.2 ✓ erosion 0 mm ✓ labels 5
Hospital_044/dialysis.pdf                pairs  336!  fill 27.5× 8.6   erosion none  labels 5
```

| Signal | Sheets it worked on |
| --- | --- |
| Wall-pair count small enough to be a room's walls | **0 / 6** |
| Free-space fill within 10 % of the room | **1 / 6** |
| Some erosion radius within 10 % of the room | **1 / 6** |
| Sheet carries at least one room-name label | **6 / 6** |

### Wall pairs — 0 / 6

Between 106 and 336 pairs per sheet. The rule that works beautifully on a *single cross-section*
— take the outermost same-colour pair at plausible wall thickness — matches furniture, ceiling grids
and setting-out lines everywhere when applied to a whole sheet. Hospital_044's bed frames are drawn
202 mm apart and are a textbook wall by every local test.

The cross-section version survives because "outermost on this line" is a strong extra constraint.
There is no whole-sheet equivalent of it.

### Free-space fill — 1 / 6

The failures are not near misses. One seed landed inside a bed (1.1 × 0.8 m). One filled the entire
sheet (39.2 × 12.7 m). One leaked along the building (Hospital_044: 27.5 m across a 17.6 m hall).
The one success needed no erosion at all, which means that room happened to be fully enclosed.

### Erosion sweep — 1 / 6, and the finding is in the failure

Eroding free space severs necks narrower than twice the radius, which is the standard way to
separate rooms at their doorways. On Hospital_044, sweeping the radius:

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
the hall opens directly onto the circulation core, the way a ward opens onto a corridor. A doorway
is a 900 mm neck and erosion severs it; a room-width opening is not a neck at all.

### Room labels — 6 / 6

Every sheet names its rooms in extractable text, with a position: `정수실`, `탈의실`, `창고`,
`물품실`, `폐기물`, `간호사실`, `휴게실`, `화장실`. Four to seven per sheet. This is the only signal
present on every drawing tested, and it is **semantic, not geometric**.

---

## 3 · What this changes

The priority list runs geometry-first — detect the room, extract its boundary, then find doors, walls
and connectivity — with recognition last. On this corpus that order cannot start: step 2 has nothing
to extract on four sheets in six, and step 4 is unusable on all six.

**The anchor has to come first, and the anchor is semantic.** Two candidates, both present in the
data and both citable:

1. **Room-name text.** On all six sheets. Names a room and locates it. The dialysis hall is often
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

## 4 · Caveat on the ground truth

The room dimensions these signals were scored against come from the cross-section measurement, and
that measurement is itself only *verified* on Hospital_044, where it agrees with the title block's
area figure to 0.6 %. On the other five it returns the **building's** width wherever the treatment
room does not span its building — the finding already recorded in the validation programme.

So this study says the four signals **disagree with each other and with the cross-section**, and it
says exactly how. It does not say any of them is wrong by a measured amount, because on five of six
sheets there is nothing yet to be wrong against. That is the same reason room understanding is worth
building: the corpus has no independent statement of where its rooms are.

---

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
