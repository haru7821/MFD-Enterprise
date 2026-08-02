# PILOT-001 — human-provided context

Recorded verbatim as supplied in the Pilot-001 input decision. Nothing here is inferred.

## Drawing

| Field | As provided |
| --- | --- |
| Drawing ID | `Vantive_Layout_001` |
| Page | Page 1 |

**Does not resolve.** See [`BLOCKED.md`](BLOCKED.md) — this identifier matches no catalogued drawing
and no file in the dataset, so extraction cannot start against it.

## Facility

Dialysis room.

## Review objective

> Renamed from **Engineering question** by owner review. The old name implied the engine answers a
> question the user poses; nothing in the pipeline reads this field, so the name claimed a behaviour
> the code does not have. The objective belongs to the reviewer, not to the engine. See
> [`../../../docs/PILOT_VALIDATION_PROCESS.md`](../../../docs/PILOT_VALIDATION_PROCESS.md) §2.
>
> The wording below is unchanged — only the field it sits under.

> 해당 공간에서 적정 장비 대수는 몇 대인가?

> The objective is to evaluate the number of equipment stations supported by the available evidence
> for this Dialysis room.

### Objective — ratified by the owner, binding on this run

> *"Evaluate the number of equipment stations supported by available evidence for this Dialysis
> room."*
>
> **Not** to be interpreted as requesting an unconditional recommended equipment count.

This was recorded before the run as a note; the owner has since stated it as the governing
interpretation, so it is now the ratified reading rather than an observation. The objective is to
establish what the *evidence* supports — which the engine may satisfy with an abstention.

The distinction has teeth at review time: a result reading *"the evidence supports no statement about
station count"* **satisfies** this objective. It is not a failure to meet it.

`stationTarget` is an input to the solver, and `resolvedStationCount` / `countWasDerived` record
whether a count was supplied or derived. Which of those applies is part of what the review examines.

## Requester

Account Name

> Recorded as supplied. This reads as a placeholder rather than a named requester; it is **not**
> blocking for machine execution, and it is noted so the review stage can replace it with the actual
> account if that was the intent.

## Operator

영업/TS 담당자 — **실행 담당자 지정 필요** (execution owner still to be designated).

**Not provided.** The supplied value states that the operator has yet to be designated, so this
field is empty rather than filled with a role name. See [`BLOCKED.md`](BLOCKED.md).

## Reviewing engineer

TS Team Supervisor (D9–D12 confirmation reviewer).

> A role, not a person. Not blocking for machine execution — but a confirmation's `name` must
> identify an individual, so the person holding that role has to be named before any confirmation is
> recorded. Flagged for the review stage.

## Machine execution scope, as authorised

Permitted: input preparation · evidence extraction · evaluation · rationale generation · result
package creation.

Stops before: engineer review · confirmation creation. Those remain human actions.
