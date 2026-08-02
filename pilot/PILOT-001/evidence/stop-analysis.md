# PILOT-001 · Evidence extraction — stop analysis

| | |
| --- | --- |
| Drawing | `Hospital_044/dialysis.pdf`, page 0 of 1 |
| `sha256` | `4e795d5b…32d4` — verified against `knowledge/dataset.json` **before** extraction |
| Selection | `full-document` — no page selected, so every page analysed. One page in this document |
| **Reached** | `verify_mapping` |
| **Stopped at** | `room` |
| Verification record written | **No** — a run that stops produces no verification record. `evidence/` holds the log and this analysis instead, which is the correct state, not a missing file |

## What it found

**`VD-1` · `drawing_error` · printed dimension "3000"**

> The label states 3,000 mm; the geometry beneath it measures 3,093 mm at the sheet's scale of
> 1:100.02 (implied 1:97.01, −3.01 % out). Consistent with a manual text override in the CAD file.
> Excluded from the calibration and from the knowledge base, and **not corrected** — a dimension text
> that disagrees with its own geometry is a question for whoever holds the drawing.

**`VD-4` · `insufficient_evidence` · the treatment room's extent is not established**

> The sheet does not state its treatment room's extent, and nothing in this pipeline can derive it…
> A person must confirm the rectangle before anything is placed in it.

## Did it stop where a person would stop, and for the reason a person would give?

**This is the question the reviewing engineer answers, and it is deliberately left open here.** The
engine does not participate in that judgement.

What can be said without judging it: the stop is at `room`, which is the furthest stage any drawing
in the corpus reaches — 15 of 306 get here; 211 stop at `import` and 80 at `calibrate`. So this
sheet got as far as the pipeline currently goes.

The two findings are different in kind, and the review should treat them separately:

- **`VD-4` is the pipeline's known limit.** Room identification is not built. The engine declining to
  guess which rectangle is the treatment room is the abstention working, not a defect.
- **`VD-1` is a claim about the drawing**, not about the engine. It asserts that a printed dimension
  text disagrees with the geometry under it by 3.01 %. **That is checkable against the sheet, and
  checking it is exactly what the review is for.** If the engineer finds the label and the geometry
  agree, the engine has misread a real drawing — a defect, and precisely the kind the 1,350-test
  suite cannot find.

## What was withheld, and why

Observations were **not** written to the knowledge base (`--observations skip`). The repository state
is frozen for this pilot: `git status --porcelain knowledge/` is empty before and after every run in
this record. This drawing's observations were already committed by earlier work; re-writing them was
not needed to validate anything here.
