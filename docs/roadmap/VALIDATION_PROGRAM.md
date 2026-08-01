# The validation programme

> Owner direction, after Sprint 6:
> *"Sprint 6 MVP is complete. From this point onward, prioritize validation and knowledge acquisition
> over new features … The objective is no longer to add features. The objective is to make the
> application trustworthy enough that an engineer can use it on real hospital projects. Whenever
> there is a conflict between functionality and traceability, choose traceability. Whenever there is
> a conflict between automation and evidence, choose evidence."*

This document is the standing account of that programme: what it runs, what it found, and what the
findings say about where the next effort belongs.

| | |
| --- | --- |
| Run it | `pnpm validate:corpus` — every drawing · `pnpm verify:drawing` — one, in detail |
| Ledger | `knowledge/validation/corpus.json` |
| Records | `knowledge/verification/<drawing>.json` |
| Checked in CI | `packages/layout-knowledge/src/verification.test.ts` |

---

## 1 · The programme

Every catalogued drawing goes through the nine stages the owner listed, in order, and stops at the
first one the evidence cannot carry:

```
import → calibrate → verify_mapping → room → place → rules → optimise → plan → report
```

Calibration is **dimension lines first, always**; the printed scale is run afterwards as a
comparison and is refused outright on a sheet whose title block names a paper size the file is not.
One implementation serves both entry points (`scripts/lib/validateDrawing.ts`) — a second would let
the corpus run and the single-drawing run disagree about what a drawing is worth, and the one that
ran less often would be the wrong one.

**Stopping is a result, not an error.** Most drawings do not reach the end, and running them is how
we find that out. Every stop names its stage and carries a classified discrepancy, so *"**62** sheets
carry no dimension set this reader can establish a scale from"* is a finding rather than a stack
trace.

> That figure read **58** and was not derivable from any ledger this repository has held — it was 61
> when the sentence was written and is 62 now. Re-derived from `knowledge/validation/corpus.json`:
> 62 rows stop at `calibrate` with `VD-7 insufficient_evidence · no scale can be established`, the
> `reconcileScale` refusal. The other 18 calibrate stops are a different finding — 14
> `extraction_error` and 4 `insufficient_evidence` on *"the sheet does not agree with itself on one
> scale"*, which is a sheet with dimensions that contradict each other rather than one without any.
> The old wording covered both under "fewer than two readable dimensions"; it is one number for one
> cause now.

### The five classifications

Every discrepancy is one of these, because the classification decides *who acts*:

| Class | Means | Who acts |
| --- | --- | --- |
| `drawing_error` | The drawing contradicts itself | Whoever holds the CAD file |
| `extraction_error` | We read the drawing wrongly | Us — the reader |
| `algorithm_defect` | We read it right and then got it wrong | Us — the engines |
| `unsupported_drawing` | A kind of file this product does not read | A product decision |
| `insufficient_evidence` | The drawing does not carry what was needed | Nobody; ask for a better drawing |

Sorting by symptom would not do this. `VD-2` — a calibrated scale disagreeing with the printed one —
is a drawing error when the sheet was replotted at a different size and an extraction error when the
reader paired a label with the wrong line. Same symptom, opposite owners, so the run classifies it
rather than the code.

**No drawing is ever silently corrected.** A discrepancy is recorded with `resolved: false` and left
alone.

---

## 2 · What the corpus says

306 drawing-pages across 300 catalogued drawings.

| | Pages |
| --- | ---: |
| **Complete — ran every stage *and* a person confirmed it** (`totals.completed`) | **0** |
| Ran every batch stage, awaiting confirmation (`totals.batchComplete`) | 0 |
| Stopped at `import` | 211 |
| Stopped at `calibrate` | 80 |
| Stopped at `room` | 15 |

The first two rows are separate counts under **owner decision D7** — *"the programme is complete only
after a human-confirmed run; batch execution alone is not completion"*. They both read 0 today, which
is exactly why the ledger keeps them apart: with one number and one word, a batch reaching its own
last stage was recorded as the programme being complete, and that is what put *"two complete all nine
stages"* into `HOSPITAL_044_VERIFICATION.md` while this ledger said zero.

### Where a confirmation lives

`knowledge/validation/confirmations.json`, and **the batch only ever reads it** — owner decision D9.

The first attempt put `confirmedBy` on the ledger row and stopped there. Review found that nothing in
the repository ever wrote a non-null one: `validate-corpus.ts` rebuilt every row from the dataset with
`confirmedBy: null` hardcoded, overwrote the ledger, and re-read it only afterwards. A signature would
have been destroyed by the next run, silently — while the comment beside the code claimed the
opposite. `totals.completed` was pinned at 0 by construction, so D7's distinction existed in the
schema and nowhere else.

The split is what fixes it rather than care: `corpus.json` is generated and may be deleted and rebuilt
from the dataset at any time; the one datum that cannot be regenerated sits in a file no batch writes.

A confirmation binds to `drawingId` + `page` + `sha256` **and the run's outcome** — `reached`,
`stoppedAt`, `discrepancies` (owner decision D10). Change any of them and it stops applying, because
"confirmed" has to mean something about the run being reported rather than a run that once existed.
This corpus has already moved under its own review — `byStage.room` went 8 → 15 without a single row's
identity changing, which is precisely where a signature bound to the hash alone would have stayed
alive. A confirmation whose subject has moved is **kept**, never deleted, and reported by the run: a
person's act is evidence, it has simply stopped asserting anything.

The file ships empty, and **for two reasons rather than one**: no completed run exists to confirm —
all 306 pages stopped — and no stop has been confirmed either. The first sentence of that is
structural, not neglect, and it is why a stop is confirmable at all (owner decision D12): confirming
*"this sheet genuinely carries no dimension set a scale can be established from"* is a different act
from confirming a completed run, counted on its own as `totals.stopsConfirmed` and never summed with
`completed` or `batchComplete`. A correctly diagnosed failure to read a drawing is not a step towards
reading it.

A row takes one confirmation — the earliest by (`at`, `name`), so appending to the file does not
change the ledger's bytes — and any further signature on the same row is **reported as a duplicate**,
in a different sentence from a stale one, because the two ask different things of whoever signed
(owner decision D11). Neither is ever deleted.

By classification — a run can raise more than one:

| Class | Count |
| --- | ---: |
| `unsupported_drawing` | 211 |
| `insufficient_evidence` | 81 |
| `extraction_error` | 20 |
| `drawing_error` | 3 |
| `algorithm_defect` | 0 |

### Zero is the honest number, and it went from two to zero on purpose

The batch run completes on nothing, because **it cannot establish a room and no longer pretends to**.

An earlier version completed on two, then on six once an unrelated filter was removed — over rooms of
4.1 × 5.3 m and 15.6 × 14.2 m that no drawing states. The room rectangle was the sheet's longest
printed dimension by the outermost wall pair across it, and both of those are dimensions of the
*building* on most sheets. The standing review caught it; §5 of
`ROOM_UNDERSTANDING_FEASIBILITY.md` has the measurements.

So the `room` stage now requires a person to confirm the rectangle, and the batch supplies no such
confirmation. `pnpm verify:drawing --room "<how it was confirmed>"` does, one drawing at a time —
which is why `knowledge/verification/` holds two full records while the ledger says nothing
completed. The measurement stays automatic; the acceptance is a person's, because there is no
evidence here yet and evidence beats automation.

**The two verified drawings are both Hospital_044's**, corroborated against the title block's own
stated area: 199.8 m² computed against 201.1 m² printed, 0.6 % apart on a plan that is not a true
rectangle.

### Reading the rest honestly

**The 211 are not a defect.** 146 are DWG, which this product refuses by name — a different product
decision, not a missing feature — and 65 are scans with no vector content to read. Two thirds of the
corpus is out of scope before any code runs, and that is worth knowing precisely.

**The 80 at `calibrate`.** Of the 89 vector CAD exports, most carry fewer than two readable
dimensions, or carry dimensions that do not agree on one scale. A sheet with a plan at 1:100 beside a
detail at 1:20 produces two internally consistent groups, and a reconciler that took the larger would
measure the whole sheet against the detail. So the run requires four agreeing dimensions and under a
fifth disagreeing, and refuses otherwise. Fourteen of these are classified `extraction_error` rather
than `insufficient_evidence`, because their outliers are an *order of magnitude* out — that is this
reader pairing labels with the wrong lines, not a drawing disagreeing with itself, and it would be
dishonest to file it against the drawing.

**The 15 at `room` are the next milestone in one number.** The scale is established, the mapping
verified, and nothing can say which walls bound the treatment room.

**Three drawing errors in the whole corpus**, all dimension text disagreeing with the geometry
beneath it by an override-sized margin:

| Drawing | Label | Out by |
| --- | --- | ---: |
| `Hospital_044/dialysis.pdf` | `3000` | −3.0 % |
| `Hospital_044/ro_room.pdf` | `3000` | −2.9 % |
| `Hospital_025/dialysis_typeA.pdf` | `1,950` | +1.3 % |

The first two are the same override seen on two plots of one plan by different software, which is
what makes it a fact about the CAD model rather than about a plot.

**Zero algorithm defects — and that is an absent key, not a measurement.** The containment defect
found by the first Hospital_044 verification (VD-5, A-4) is fixed, and the self-check that caught it
still runs: any finding claiming equipment extends beyond a room whose every corner is inside that
room is recorded as `algorithm_defect` rather than transcribed.

But it sits at the `rules` stage, which **no batch page now reaches**. A class with no entries here
means nothing got that far, not that the engines were exercised and found sound. The same is true of
every stage past `room`: the optimiser, the planner and the report have been run on the two
hand-corroborated drawings and nothing else. This row is a very small sample reported as a total, and
it should be read that way.

---

## 3 · The knowledge base

Expanded **only** from observations a run is prepared to stand behind, and every one carries the
eight things the owner listed: drawing SHA-256, drawing identifier, page, observation type, measured
value, measurement method, observer, confidence. `page` was added for this programme — a drawing set
is one file holding several sheets, and every page of it shares one hash, so without it a reading
from sheet 7 is indistinguishable from one off the cover.

**One** reading is in the base from the verification programme so far:

| Value | Method | Confidence |
| --- | --- | --- |
| `treatment_room_width` 7,402 mm | `calibrated_measurement` — nothing on the drawing states it | medium |

There were two. `station_pitch` 2,000 mm was **retracted**, because the run that recorded it had also
required the drawing to print 2,000 mm before it could proceed — so the reading could not have come
out any other way. A number that could not have been different is not evidence of anything. The
corpus still holds the pitch from 117 drawing files — **24 facilities** (owner decision D6) — whose
dimensions are *annotated* as a bed spacing;
geometry alone cannot tell a pitch from any other 2,000 mm dimension, and that naming is what makes
those readings mean something.

`pnpm validate:corpus` writes **no observations at all**. Only `pnpm verify:drawing` does, one
drawing at a time, after a person has read what it found. A knowledge base a batch job can fill on
its own is one nobody has checked.

**Independent evidence, or nothing.** `Hospital_044/ro_room.pdf` reaches `verify_mapping` and stops
at `room`, like its twin `dialysis.pdf`, and its observations would be withheld even if it ran to the
end: it is the same floor plan as `dialysis.pdf` plotted by different software, so counting both
would claim two drawings support a figure that one room produced. `support` is a count of independent
evidence or it is meaningless.

> Corrected twice, and the second one is worth recording. This read *"completed the whole
> programme"*; the first correction read *"ran every batch stage"*, which the ledger does not support
> either — both rows carry `stoppedAt: "room"`. It was rewritten from the sentence rather than from
> `knowledge/validation/corpus.json`, which is how the original claim survived. Owner decision D7 —
> **batch execution alone is not completion** — is the structural half of the fix; reading the ledger
> before writing about it is the other half.

---

## 4 · Next milestone — automatic room understanding

The **15** drawings that stop at `room` are the case for this, and Hospital_044 is the case against
guessing. (This read 8, against the ledger's own 15 in the table above — two figures for one count,
in one document, disagreeing.) `measureRoomWidth` takes the outermost same-colour wall pair on a
cross-section. Where the
treatment room spans its building — Hospital_044 — that is the room's own walls, and the answer
checks against the title block's area figure to 0.6 %. Where it does not, the same arithmetic returns
the *building's* width: 11 to 14 m against a known 7.4 m. Nothing in the geometry distinguishes the
two, so the run discards readings outside a plausible band and reports them rather than using them.

The owner's priority order, and what each means here:

1. **Dialysis room detection** — which region of the plan is the treatment area
2. **Boundary extraction** — the polygon that bounds it
3. **Door detection** — openings, which are also where a boundary legitimately breaks
4. **Wall classification** — structural, partition, glazing
5. **Room connectivity** — which room reaches which, for delivery routes and egress
6. **Object recognition** — bed, nurse station, sink, RO room, drain, electrical panel

> *"Do not implement machine-learning models unless deterministic approaches have been exhausted
> first."*

Deterministic approaches are nowhere near exhausted, and the evidence for that is in this repository.
Reading printed dimensions off vector geometry looked like a job for a model and turned out to be a
layer colour, a parallel test and a rule about where measure points sit — and it now reads seven of
seven dimensions on the reference sheet and reproduces five of them through the mapping to 0.05 %.
The same materials are available for rooms: text runs carry room names and their positions,
same-colour parallel pairs are walls, arcs across a wall gap are door swings, and hatch patterns
differ by material.

What a deterministic approach can be honest about and a model cannot: **it can say why**. A room
boundary derived from two wall lines and a door arc can name them; one predicted by a network cannot
be cited in a report, and item 6 of the direction says every reported value must be traceable to a
calculation path.

**A deterministic feasibility study has been run before any of the six is implemented**, and it
changed the order — see `docs/roadmap/ROOM_UNDERSTANDING_FEASIBILITY.md`. The short version: whole-
sheet wall classification is unusable (0 of 6 sheets), region finding by flood fill works on 1 of 6,
and no erosion radius isolates Hospital_044's hall because that hall's ends are **not doorways** —
it opens onto circulation at room width. Room-name text, by contrast, is present and positioned on
**6 of 6**.

So the anchor has to be semantic and come first, with geometry bounding outward from it rather than
being asked to find rooms unaided. No machine learning is warranted yet, and the study is the
argument rather than the assertion.

---

## 5 · Traceability audit

> *"Every statement in the report must remain traceable. Each reported value must identify: source
> document · revision · section · observation · calculation path. Unknown must remain Unknown. Never
> interpolate. Never estimate. Never replace missing data with assumptions."*

Audited against `packages/report-engine/src/model.ts`. Where it stands today:

| Reported value | Document | Revision | Section | Calculation path |
| --- | --- | --- | --- | --- |
| Rule thresholds (`StandardRow`) | ✅ field | ✅ field | ✅ field | n/a — stated, not computed |
| Findings (`FindingRow`) | ✅ `thresholdSource` | ➖ inside the string | ➖ inside the string | ❌ **gap** |
| Equipment data (`DatasheetBlock`) | ➖ inside `citation` | ➖ inside `citation` | ➖ inside `citation` | n/a |
| Planning footprint | n/a by design — an owner decision, never cited | | | |
| Planner figures (`SourcedFigure`) | ✅ `citation` | ➖ inside the string | ➖ inside the string | ✅ `calculation` |

**Unknown stays Unknown, and that half is solid.** `SourcedFigure.value` is `number | null` with an
evidence status beside it — not `0`, not `—`. `RC-110` says *threshold unknown* rather than passing.
A draft rule cannot certify a pass at all (AD-6a), which is why Hospital_044 reports 0 GREEN and a
verdict of `inconclusive` rather than an approval.

Three gaps, none of them fixed here — the direction is validation first, and each is a report-engine
change that deserves its own decision:

- **T-1 · A finding does not carry its calculation path.** A clearance finding reports the applied
  threshold, where the threshold came from, and the measured value — but not *how* the measurement
  was made: which two faces, along which normal, against which neighbour. A reader holding the signed
  PDF can check the comparison and not the measurement.
- **T-2 · Citations are formatted strings, not fields.** `DatasheetBlock.citation` and
  `SourcedFigure.citation` flatten document, revision and section into prose. A person can read them;
  nothing can check them, and `StandardRow` already shows the better shape.
- **T-3 · The calibration does not name the dimension it came from.** `CalibrationInfo` records the
  method, the scale, and the distance typed — but not which printed dimension supplied it. The
  verification record carries `fromDimension`; the report does not, so the document an engineer signs
  is less traceable about its own scale than the record beside it.

**Observation** is the fifth item on the owner's list and is currently vacuous: no figure in a report
comes from a `knowledge/` observation, because `standards/` is normative and `knowledge/` is
descriptive, and the rule engine cannot read the knowledge package at all — asserted by
`boundaries.test.ts`. It becomes a live requirement the moment an observed figure reaches a report,
and it should not before T-1 to T-3 are closed.

---

## 6 · The separations, and how each is held

Four things must not merge, and none of them is held by discipline alone:

| Separation | Held by |
| --- | --- |
| Containment · collision · clearance | `evaluators/independence.test.ts` reads the source: clearance and collision cannot see room outlines, containment cannot see a clearance threshold, and none imports another |
| Manufacturer data · planning data | Disjoint source vocabularies in the schema — an installation group cannot cite a manufacturer document, and a planning footprint carries no verification block at all |
| Requirements (`standards/`) · observations (`knowledge/`) | `boundaries.test.ts`: the rule engine, document model, object library and report engine cannot import the knowledge package |
| Derived knowledge · hand-written knowledge | Every derived file is regenerated byte-for-byte from its observations in CI |

Containment answers *"is the equipment inside the room"*. Clearance answers *"can it be safely
operated"*. Collision answers *"does it intersect another object"*. The A-4 decision is what made the
first of those a question about geometry only: a machine flush against a wall is in the room, and
whether it can be serviced there is a different finding from a different rule with a document behind
it.
