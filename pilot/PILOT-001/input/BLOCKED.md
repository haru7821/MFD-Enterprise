# PILOT-001 — execution not started

**Two required input fields do not resolve.** Extraction has not been run, `run-metadata.json` has
not been created, and no folder beyond `input/` contains anything.

Recorded rather than worked around: substituting a drawing or naming an operator would be exactly
the inference the execution boundary forbids, and it would put fabricated identity into the first
real pilot record.

---

## Blocker 1 — the drawing identifier resolves to nothing

| Provided | `Vantive_Layout_001`, Page 1 |
| --- | --- |
| In `knowledge/dataset.json` | **No.** 300 drawings catalogued, **0** matching `vantive` (case-insensitive) |
| In the dataset on disk | **No.** No file matching `*vantive*` under the dataset root |

Every catalogued identifier has the shape `Hospital_NNN/<sheet>.<ext>` — for example
`Hospital_044/dialysis.pdf`. `Vantive_Layout_001` matches nothing in either the catalogue or the
filesystem, so this is not a hash mismatch; the sheet itself cannot be located.

`input/README.md` already states the rule for the weaker version of this problem: *if the `sha256`
does not match the catalogue, the run is against a different file than the one catalogued and the
record would be false — stop.* An identifier that resolves to no file at all is a stronger case of
the same thing.

### What is needed

One of:

1. **A catalogued `drawingId`** — chosen by a person, from the 300 in `knowledge/dataset.json`.
2. **The `Vantive_Layout_001` drawing file itself**, if it exists outside the current dataset. It
   would need cataloguing (`pnpm dataset:ingest`) before a pilot could cite it, so that its `sha256`
   is recorded before it is read.

**No drawing has been selected here, and none will be.** For information only, the 15 sheets that
reach the furthest stage the pipeline currently achieves — room understanding — are listed below.
This is the state of the corpus, not a recommendation, and choosing among them is a human decision:

```
Hospital_008/dialysis_typeA.pdf          Hospital_033/dialysis_rev03.pdf
Hospital_022/dialysis_typeB.pdf          Hospital_033/dialysis_rev04.pdf
Hospital_023/dialysis_typeB_30bed.pdf    Hospital_035/dialysis_typeA_16bed_2.pdf
Hospital_025/dialysis_typeA.pdf          Hospital_039/dialysis_18bed_rev01.pdf
Hospital_025/dialysis_typeB.pdf          Hospital_044/dialysis.pdf
Hospital_025/dialysis_typeC.pdf          Hospital_044/ro_room.pdf
Hospital_028/dialysis_typeA.pdf          Hospital_045/dialysis_typeA_2.pdf
Hospital_033/dialysis_rev01.pdf
```

All 15 carry `VD-4: insufficient_evidence`; several also carry `VD-1`. **Every one of them stops** —
as do all 306 rows in the corpus. A stop is a valid pilot outcome, so this does not disqualify any
of them; it is what the pilot is for.

## Blocker 2 — the operator has not been designated

| Provided | 영업/TS 담당자 — **실행 담당자 지정 필요** |
| --- | --- |

The supplied value states that the execution owner is still to be designated. `operator` is
therefore left empty rather than filled with a role name.

This matters beyond bookkeeping: `run-metadata.json` records who performed the run, and a role name
in that field would make the record unable to say who to ask about it.

### What is needed

The name of the person who will perform the run.

---

## Not blocking, but flagged for the review stage

| Field | Provided | Issue |
| --- | --- | --- |
| Requester | `Account Name` | Reads as a placeholder rather than a named account. Machine execution does not depend on it |
| Reviewing engineer | `TS Team Supervisor` | A role, not a person. A confirmation's `name` must identify an individual, so the holder must be named **before** any confirmation is recorded — not before extraction |

## What has been recorded

- [`context.md`](context.md) — the human-provided context, verbatim
- This file

## What has **not** been done

- `run-metadata.json` — not created; drawing identity and operator are unresolved
- `evidence/`, `result/` — empty; extraction has not been run
- `review/`, `confirmation/` — empty; those are human stages and were never in scope for this step

**PILOT-001 remains NOT EXECUTED.**
