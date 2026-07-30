# @mfd/ai-local

The deterministic layout solver. Pure TypeScript, with the rule engine as its oracle, and **no
model in it**.

Sprint 6, step 3: candidate generation and the two hard gates. Scoring is step 4.

---

## The pipeline, in the owner's approved order

```
input requirements
       ↓
generation                ── arrangements holding exactly the resolved count
       ↓
Gate 1 · station count    ── exact. Never adds, never removes.
       ↓
Gate 2 · rule compliance  ── any mandatory violation is discarded
       ↓
feasible candidates       ── the only thing the scoring engine ever sees
```

**The seam after Gate 2 is the architecture.** A candidate that failed a gate is never handed to
the scoring engine — not handed to it and scored zero, *never handed to it*. That is the structural
form of *"rule violations shall never be compensated by optimization scores"*: a property of the
data flow rather than of a number that could be outvoted.

## Why the gates are not just heavily-weighted criteria

A weighted sum is a mechanism for trading things off, and anything inside one can be outvoted by
the rest of it however large its weight — 40 % is still a minority. A requirement that must never
be traded therefore cannot be expressed as a weight at all.

| Gate | Rejects | The failure it prevents |
| --- | --- | --- |
| 1 · station count | Too few **and too many** | A solver that "improves" a score by dropping a machine, or adds one nobody asked for |
| 2 · compliance | Any mandatory violation | A layout that buys a clearance breach with a shorter pipe run |

Gate 1 rejecting *too many* is the half that is easy to omit. Every scored criterion improves as
machines are removed, so shedding is the failure everyone anticipates; adding one unasked is its
mirror and produces a layout the engineer did not request.

## The one distinction that makes Gate 2 usable

It rejects **RED**, not "anything that is not GREEN".

YELLOW means *review required*, and on this product it is overwhelmingly produced by **missing
data** rather than by a breach: every clearance finding reads YELLOW because the AK98 manual has
not been supplied (A-1), and every result on an uncalibrated level is downgraded to YELLOW whatever
it was. A gate written as `level !== 'GREEN'` would reject **every** candidate on every project
this product currently has, and report *"no layout satisfies the rules"* when it means *"nobody has
given me a threshold to check against"*.

So the gate passes those candidates and reports how many findings were unevaluable, which is what
lets a proposal say its compliance is largely unestablished rather than read as cleared.

## Determinism

> *"Given identical input data, identical candidates and rankings must be produced."*

Three ways this is normally lost, all forbidden here: `Math.random`; iterating a collection built
from unordered input; and an **unstable sort key**. The third is the one that bites — two
candidates with an equal score still need a *total* order, or the ranking depends on generation
order. Every comparator ends in a tie-break on the candidate's id, and ids are derived from the
arrangement rather than from a counter.

## Tests, and the four that could not fail

24 unit tests. Each guard was broken and the failure observed:

| Guard | Broken by | Result |
| --- | --- | --- |
| Gate 1 rejects too many | `>=` instead of `===` | 1 test fails |
| Gate 2 rejects violations | Returning no rejection | 3 tests fail |
| Gate 2 does **not** reject YELLOW | `!== 'GREEN'` instead of `=== 'RED'` | 7 tests fail |
| Candidate order is stable | A clock-dependent comparator | 1 test fails |
| Packing uses the design footprint | Swapping in manufacturer dimensions | 1 test fails |
| Containment tests corners | Testing the centre only | 1 test fails |
| Obstructed slots are filtered | Removing the filter | 1 test fails |

**Four of those tests did not fail on the first attempt, and each was rewritten rather than
kept.** They are recorded because the pattern is more useful than the fixes:

1. *"Works around existing placements"* looped over survivors — and every candidate had been
   rejected, so it iterated an empty array and proved nothing. It now asserts the rejections, and a
   second test covers the case where candidates do survive.
2. *"Keeps every machine inside the room"* used a rectangle, where a centre-only containment test
   gives the same answer as a corner test by construction. It now uses a room with a slanted
   **bottom** edge, so the first row of slots straddles it.
3. *"Packs against the design footprint"* compared how many candidates two different machines
   produced. It now asserts the pitch between adjacent positions is 800 mm — the number the choice
   actually produces.
4. The generator's obstruction filter has no effect on what the pipeline *proposes*, because Gate 2
   catches an overlapping arrangement anyway. It is an efficiency measure, and it now has a test at
   the generator rather than borrowing confidence from a pipeline test that covers a different
   thing.

There is deliberately **no pipeline test for Gate 1 rejecting**: the generator is told the count and
only emits arrangements holding exactly it, so no mis-counted candidate can reach the gate on this
path. The gate is exercised directly, and stays in the pipeline as defence in depth for step 5,
where candidates come from mutating an existing layout and the count is no longer guaranteed.
