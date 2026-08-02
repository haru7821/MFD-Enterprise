# PILOT-001 · Review findings

## Per-finding verdicts, as given

| Finding | Verdict |
| --- | --- |
| **`VD-4`** · insufficient_evidence · treatment room extent not established | **Confirmed** — 리뷰를 통해 Stop 판단이 적절했음을 확인 (the review confirms the stop judgement was appropriate) |
| **`VD-1`** · drawing_error · printed dimension "3000" vs 3,093 mm geometry | **Inconclusive / 검증불가** — could not be verified |

## What this establishes

**The stop was correct.** `VD-4` is what stopped the run — the pipeline reached `verify_mapping` and
declined to proceed without a confirmed room rectangle. A person has now looked and agrees. That is
the abstention validated against a real drawing by a real engineer, which is what Pilot-001 existed
to test.

**`VD-1` remains an open claim about the drawing.** It did not cause the stop: the disagreement
between the printed dimension text and its geometry was excluded from the calibration and reported
rather than corrected. `검증불가` means the engine's claim is neither confirmed nor refuted — so the
engine has not been shown right, and has not been shown wrong.

Recorded as *inconclusive* rather than quietly dropped, because an unverified claim that disappears
from the record reads afterwards as a claim that was checked.

---

## F-1 · The confirmation model has no per-finding granularity — a Pilot-001 finding

**This is a finding about the product, surfaced by the review itself.**

The review produced a **split verdict**: one finding confirmed, one inconclusive. The confirmation
mechanism cannot express that.

A confirmation under D10 binds to `rowFingerprint(outcome)` — `drawingId`, `page`, `sha256`,
`reached`, `stoppedAt`, and **the whole discrepancy list**. It is a statement about the *row*. There
is no field in `confirmationSchema` that says *"I confirmed this finding and could not verify that
one."*

So a `stop` confirmation written from this review would record that the stop was correctly
diagnosed — true — while silently carrying `VD-1` inside the fingerprint as though it had been
checked. Nothing in the artefact would distinguish *the signer verified both* from *the signer
verified one and could not reach the other*.

**Why this matters beyond bookkeeping.** The confirmation is the one datum the system cannot
generate for itself, and its whole value is that it records what a person actually established. A
row-level signature over a split verdict overstates by exactly one finding.

**No change is proposed here.** Under the frozen priority order this goes to priority 3 — review all
findings from Pilot-001 — and priority 4 decides whether it needs a product change, a documentation
change, a process change, or **no action**. *No action* is a legitimate answer: one unverifiable
finding on one drawing may not justify changing a schema.

What the pilot has done is produce the evidence. That is the first item on this project's backlog
that was found by using the product rather than by reasoning about it.

---

## Still required before a confirmation exists

| | State |
| --- | --- |
| Outcome word — `confirmed` / `rejected` / `stopped` | Not stated. The verdicts above imply `confirmed`, and that inference is the reviewer's to make, not mine |
| `name` — a person, not a role | ❌ **required by `confirmationSchema`** (`z.string().min(1)`), and cannot be supplied from inside this repository |
| `basis` — what was checked against | ❌ required. The sheet itself, a record, a site visit |
| `kind` | Would be **`stop`** under D12, stated by the signer. A `completion` confirmation on a stopped row is rejected by the schema |

`confirmations.json` remains `[]`. `outcome.txt` is not written.
