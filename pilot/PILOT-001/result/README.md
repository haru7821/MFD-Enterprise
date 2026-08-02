# result/ — evaluation, ranking and rationale

Written by the engine. Validates **deterministic result generation** and **explanation correctness**.

| File | Contents | Required |
| --- | --- | --- |
| `evaluation.json` | The evaluation report — verdict, findings, reason codes | If evaluation was reached |
| `ranking.json` | `rankLayouts` output — ranks, ties, scores, coverage, `unavailable` | If evaluation was reached |
| `rationale.md` | Every rationale code rendered in **both** languages, as an engineer sees it | If evaluation was reached |
| `determinism.md` | Re-run comparison: same machine, different machine, locale sweep | **Yes** |

If extraction stopped before evaluation, the first three are absent and `determinism.md` records
that the *stop* reproduced.

## Expected result — not a defect

Every clearance finding will read `RC-110` and the verdict will be **판정 불가 / Inconclusive**,
because A-1 is unresolved and every rule threshold is `null`. `compliance_margin` — 40 % of the
scoring model — will be unmeasurable.

**Do not resolve this by supplying a figure.** A threshold entered here needs a document number, a
revision and a section; the schema rejects it otherwise, and that rejection is the guard working.

## What `rationale.md` validates

The sentence, not the score. An explanation that names a criterion the engine did not measure, or
omits an abstention, is a defect **even when every number is correct**.
