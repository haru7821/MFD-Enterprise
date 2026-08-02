# review/ — the engineer's judgement

Written by the reviewing engineer. **The engine does not participate in this stage.**

| File | Contents | Required |
| --- | --- | --- |
| `review.md` | Completed checklist §6 — who reviewed, when, against what, how long | **Yes** |
| `outcome.txt` | Exactly one word: `confirmed`, `rejected` or `stopped` | **Yes** |
| `findings.md` | Defects, friction, and anything the workflow could not deliver | If any |

## Outcomes

| Outcome | Means | Next |
| --- | --- | --- |
| `confirmed` | Reviewed, and the output is correct | Proceed to `confirmation/` |
| `rejected` | Reviewed, and the output is wrong | `findings.md` is the deliverable. **No confirmation.** |
| `stopped` | Could not reach a reviewable result | Record why. **No confirmation.** |

**A `rejected` outcome must not create a confirmation record.** A confirmation asserts that a person
checked something and found it correct; attaching one to a rejection puts a false statement into the
one file this product treats as ground truth.

## The review must be able to end in "no"

A pilot that can only end in a signature is not a validation. `rejected` is a complete and
successful outcome — it means the exercise found something 1,327 unit tests and 156 browser specs
could not.

Do not repair the engine and re-run to convert a `rejected` into a `confirmed`. Record the
rejection, fix the defect as separate work, and run **PILOT-002** against the fix. Overwriting a
rejection erases the only evidence that the review process works.
