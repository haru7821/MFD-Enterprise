# PILOT-001

> **Status: MACHINE STAGES COMPLETE — awaiting engineer review.**
>
> Drawing `Hospital_044/dialysis.pdf`, page 0 of 1, `full-document`. Hash verified against the
> catalogue before extraction. **The run stopped at `room`** after completing `verify_mapping`,
> with `VD-1` (drawing_error) and `VD-4` (insufficient_evidence). A stop is a valid outcome.
>
> No evaluation, ranking or rationale was produced — extraction stopped before them, so their
> absence is the result, not a gap.
>
> **`review/` and `confirmation/` are empty and stay that way until a person acts.** The machine
> scope ends here.
>
> Procedure: [`../../docs/PILOT_VALIDATION_PROCESS.md`](../../docs/PILOT_VALIDATION_PROCESS.md) ·
> Checklist: [`../../docs/pilot/PILOT-001-CHECKLIST.md`](../../docs/pilot/PILOT-001-CHECKLIST.md)

The first real operational validation. **Not a feature test** — it validates evidence extraction,
deterministic result generation, explanation correctness, the engineer review process, and
confirmation recording.

## Constraints on this run

- **Do not modify solver logic.** The pilot observes the engine as built.
- **Do not tune thresholds**, and **do not add A-1 assumptions**. Every clearance rule carries a
  `null` threshold and will read `RC-110`; the verdict will be **판정 불가 / Inconclusive**. That is
  the expected result.
- **The purpose is observation of real usage, not improving the answer until it passes.** A result
  the engineer rejects is a successful pilot and a real finding. Changing the engine mid-run to
  produce a better answer destroys what the run was for.

## Folders

| Folder | Holds | Written by |
| --- | --- | --- |
| [`input/`](input/) | What the run was pointed at, fixed before it starts | Operator |
| [`evidence/`](evidence/) | What the engine extracted, and where it stopped | Engine |
| [`result/`](result/) | Evaluation, ranking and rationale | Engine |
| [`review/`](review/) | The engineer's judgement and its outcome | Reviewing engineer |
| [`confirmation/`](confirmation/) | The signature, if the outcome was `confirmed` | Reviewing engineer |

Each folder's `README.md` defines the files expected in it.

## Review outcome — exactly one

| Outcome | Means | Confirmation record |
| --- | --- | --- |
| `confirmed` | The engineer reviewed the output and it is correct | **Created** |
| `rejected` | The engineer reviewed the output and it is wrong | **Must not be created** |
| `stopped` | A **valid completed outcome** — the pilot could not reach a point where an engineer could judge anything | **Must not be created** — no review occurred, so there is nothing to sign |

**`rejected` results must not create confirmation records.** Not "should not" — a confirmation
asserts that a person checked something and found it correct, so a confirmation attached to a
rejection is a false statement in the one file the product treats as ground truth.

`stopped` is distinct from `rejected`: `rejected` means the engineer looked and disagreed;
`stopped` means there was nothing to look at. Both are complete, legitimate outcomes. Only
`confirmed` produces a signature.

Note that a run whose *pipeline* stops (at import, calibrate or room) can still be reviewed and
`confirmed` — confirming a **stop** is a separate act under D12, and given all 306 corpus rows
currently stop, it is the act most likely available here. `stopped` as a review outcome means
something different: the pilot itself could not proceed to a review.

## Progress

- [ ] `input/` — run metadata fixed, drawing hash verified against the catalogue
- [ ] `evidence/` — extraction run, stop stage and classification recorded
- [ ] `result/` — evaluation and rationale captured, determinism re-checked
- [ ] `review/` — engineer review performed, outcome recorded
- [ ] `confirmation/` — signature recorded, **only if** outcome is `confirmed`

**Pilot-001 is not complete until a real engineer review has occurred.** Machine stages finishing
does not complete it.
