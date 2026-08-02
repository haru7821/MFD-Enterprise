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
| `stopped` | A **valid completed outcome** — the run stopped rather than producing a reviewable result | Record why. **No confirmation, unless the defined process allows it** — see below |

**A `rejected` outcome must not create a confirmation record.** A confirmation asserts that a person
checked something and found it correct; attaching one to a rejection puts a false statement into the
one file this product treats as ground truth. There is no exception to this one.

## `stopped` — two different things, and only one of them can be confirmed

The word does double duty, and conflating the two senses would either lose a legitimate signature or
manufacture an illegitimate one.

| Sense | Means | Confirmation |
| --- | --- | --- |
| **The pipeline stopped** | Extraction halted at import, calibrate or room, and recorded why | **Allowed** — as a `kind: "stop"` confirmation under D12, if the engineer reviewed the stop and found it correctly diagnosed. The review outcome in that case is `confirmed`, not `stopped` |
| **The pilot stopped** | The exercise could not reach a point where an engineer could judge anything | **Not allowed.** There was no review, so there is nothing to sign |

`stopped` in `outcome.txt` means the **second**. A run whose pipeline stopped but whose stop was
reviewed and found correct is `confirmed` — that is the act D12 exists for, and given all 306 corpus
rows currently stop, it is the act most likely available in Pilot-001.

The test is not what the engine did. It is **whether a person reviewed it and reached a judgement.**

## The review must be able to end in "no"

A pilot that can only end in a signature is not a validation. `rejected` is a complete and
successful outcome — it means the exercise found something 1,327 unit tests and 156 browser specs
could not.

Do not repair the engine and re-run to convert a `rejected` into a `confirmed`. Record the
rejection, fix the defect as separate work, and run **PILOT-002** against the fix. Overwriting a
rejection erases the only evidence that the review process works.
