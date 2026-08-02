# confirmation/ — the signature

Written **only** when `review/outcome.txt` reads `confirmed`. If it reads `rejected` or `stopped`,
this folder stays empty, and that is the correct final state.

| File | Contents | Required |
| --- | --- | --- |
| `confirmation.json` | The entry as appended to `knowledge/validation/confirmations.json` | If confirmed |
| `ledger-effect.md` | `totals` before and after, and which row the signature bound to | If confirmed |
| `binding-check.md` | Evidence that D10's binding was observed — the signature stops applying when the run's outcome changes | If confirmed |

## Validity

A valid confirmation requires a **real engineer**, a **real drawing**, and an **actual review
action**. Excluded: synthetic fixtures, generated confirmations, replay tests, back-fills from the
ledger's own contents, and placeholders entered to move a count off zero.

Every excluded form above would **parse**. The distinction is not syntax — it is whether a person
looked and then signed, which no schema can check.

## `binding-check.md` is the point

D10 says a confirmation binds to the run's *outcome*, not merely the file's bytes, so it stops
applying the moment the pipeline's reading of that page changes. That behaviour has only ever been
exercised against fixtures.

Observing it once, against a signature a person actually gave, is a large part of what Pilot-001 is
worth — and it is the step most likely to be skipped, because by then the count has moved and the
run feels finished.
