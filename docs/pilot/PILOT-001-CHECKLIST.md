# Pilot-001 Checklist — BLANK TEMPLATE

> **VantiCAD Layout** · Evidence-First Layout Decision Support · TS Edition
>
> Procedure: [`../PILOT_VALIDATION_PROCESS.md`](../PILOT_VALIDATION_PROCESS.md)

**This template is intentionally blank.** Do not fill it in place — copy it to
`docs/pilot/PILOT-001.md` and complete that copy as the run proceeds, not afterwards.

Leave any field you cannot fill **empty**, and record why in §7. An empty field is evidence that
something could not be established. A guessed one is not.

---

## 1 · Input record — complete BEFORE the run

| Field | Value |
| --- | --- |
| Drawing identifier (`drawingId`) | |
| Page | |
| `sha256` | |
| Hash matches `knowledge/dataset.json`? | ☐ yes ☐ no — if no, **stop** |
| Project context — facility | |
| Project context — question being asked | |
| Project context — requested by | |
| Room type | |
| Catalogue records used, with `version` of each | |
| Rule set id / version | |
| Rule set status (expect `draft`) | |
| Scoring model id / version | |
| **Solver version — full git commit SHA** | |
| Working tree clean at that SHA? | ☐ yes ☐ no |
| Execution date (ISO-8601, with offset) | |
| Operator | |

## 2 · Evidence extraction

| | Result |
| --- | --- |
| Command run | |
| Reached stage | |
| Stopped at stage (blank if completed) | |
| Discrepancy codes and classifications | |
| Does the stop reason match what the drawing actually shows? | ☐ yes ☐ no |
| If no — what the drawing shows instead | |

**Validating:** that the engine stopped where a person would stop, and for the reason a person would
give. A stop is a valid outcome. A stop for the *wrong reason* is a defect.

## 3 · Deterministic result generation

| Check | Result |
| --- | --- |
| Re-run on the same machine — output identical? | ☐ yes ☐ no |
| Re-run on a **different** machine — output identical? | ☐ yes ☐ no |
| `git status --porcelain knowledge/` after regeneration | |
| Locale sweep (C, sv_SE, tr_TR, ko_KR, de_DE) — any diff? | ☐ none ☐ diff — record below |
| Diff, if any | |

## 4 · Layout evaluation

| | Result |
| --- | --- |
| Evaluation reached? | ☐ yes ☐ no — if no, skip to §6 |
| Verdict (expect **판정 불가 / Inconclusive**) | |
| Clearance findings (expect `RC-110` throughout) | |
| `coverage` reported | |
| Criteria reported unavailable, with codes | |
| Was any threshold entered during this run? | ☐ no ☐ yes — **if yes, record document / revision / section** |

**A-1 must not be resolved artificially.** An Inconclusive verdict is the expected and correct
result. If a threshold was entered, it must carry a document number, a revision and a section.

## 5 · Explanation correctness

| Check | Result |
| --- | --- |
| Rationale codes emitted | |
| Korean rendered? | ☐ yes ☐ no |
| English rendered? | ☐ yes ☐ no |
| Does each sentence describe what was actually measured? | ☐ yes ☐ no |
| Is every abstention stated in the explanation, not only in a field? | ☐ yes ☐ no |
| Any claim word exceeding the evidence? | ☐ none ☐ found — record below |
| Korean particle correctness (와/과) | ☐ correct ☐ wrong — record below |
| Defects found | |

## 6 · Engineer review

| | |
| --- | --- |
| Reviewing engineer (name) | |
| Date and time of review (ISO-8601, with offset) | |
| Drawing reviewed against — what was consulted | |
| Time spent | |
| Was the workflow performable as written? | ☐ yes ☐ no — record friction below |
| Friction, gaps, or steps that could not be completed | |

**Outcome — exactly one:**

- ☐ **Output is correct** → proceed to §7
- ☐ **Output is wrong** → record the defect below; **no confirmation is recorded**; the pilot outcome
  is a defect report, which is a legitimate and complete result
- ☐ **Cannot determine** → record what would be needed

Defect / what would be needed:

## 7 · Confirmation record

Complete **only** if §6 concluded *output is correct*.

| Requirement | |
| --- | --- |
| Real engineer — a person, not a role or team | ☐ |
| Real drawing — the catalogued file, hash verified in §1 | ☐ |
| Actual review action performed — §6 completed | ☐ |
| Not a fixture, generated entry, replay, or back-fill | ☐ |

| Confirmation field | Value |
| --- | --- |
| `kind` (`completion` / `stop`) — **stated, not inferred** | |
| `name` | |
| `at` (ISO-8601, with offset, signer's own timezone) | |
| `basis` | |
| Row outcome fields copied verbatim from the ledger | ☐ done |

**After appending to `knowledge/validation/confirmations.json`:**

| Step | Result |
| --- | --- |
| `pnpm validate:corpus` merged it without error | ☐ |
| `totals.stopsConfirmed` / `totals.completed` before → after | |
| Re-run produces a byte-identical artefact apart from that count | ☐ |
| **D10 binding observed** — signature stops applying when the run's outcome is changed | ☐ yes ☐ not tested |
| Entry appears in `unapplied` when it should, and not when it should not | ☐ |

## 8 · Fields left empty, and why

| Field | Why it could not be established |
| --- | --- |
| | |

## 9 · Outcome

- ☐ Confirmation recorded — the first real signature in the D9–D12 chain
- ☐ Defect report — no confirmation recorded
- ☐ Incomplete — record what blocked it

Summary:

---

**Not established by this pilot, whatever its outcome:** A-1 remains unresolved, so the product
still cannot state a true clearance verdict on any project. Pilot-001 validates that the engine
abstains correctly, explains itself, reproduces exactly, and can carry a human judgement. It does
not make the product able to answer the question it exists to answer.
