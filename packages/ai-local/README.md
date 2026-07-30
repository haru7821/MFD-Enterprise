# @mfd/ai-local

The deterministic layout solver. Pure TypeScript, with the rule engine as its oracle, and **no
model in it**.

Sprint 6, steps 3–5: candidate generation, the two hard gates, the weighted scoring engine, the
ranking, and optimisation of an existing layout.

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
       ↓
measure → normalise → weight → renormalise
       ↓
rank                      ── top 3, each with total, coverage, breakdown, exclusions, explanation
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


---

## The arithmetic (step 4)

```
measure       in the criterion's own unit — mm, a count, a fraction, a ratio
normalise     0…1, against the configured reference
weight        × the criterion's weight
renormalise   ÷ Σ weights that could be measured
total + coverage
```

**Compliance margin has two roles and they are not the same thing.** A rule *violation* excludes a
candidate at Gate 2, before scoring. The 40 % weight ranks the *quality* of the margin among
candidates that already comply — and it is never permission to trade a violation against an
optimisation score.

**A per-station reference scales with the layout.** 8,000 mm of RO pipe *per station* means a
twelve-station room is judged against 96 m, not 8 m. Without that, a bigger layout would score worse
on every routing criterion for the sole reason of being bigger — the emptiest-room bias returning
through the back door after all the work to keep station count out of the weighted sum.

**`coverage` is not decoration.** Every rule threshold is null until the AK98 manual arrives (A-1),
so the largest single weight in the approved model — compliance margin, 40 % — cannot be computed on
any real project today. A total over the remaining 60 % reads exactly like a complete one, so the
fraction is printed with it.

### Compliance margin is measured, not read off a finding

The obvious implementation is `result.measured / result.appliedValue`, and it does not work. The
rule engine reports `measured` only when something is **inside** a clearance zone — so a compliant
machine has `measured: null`, and the very layouts this criterion exists to rank are the ones the
finding cannot supply a number for.

Headroom is therefore geometry: walk outward from each governed face until something stops you —
another machine, an obstruction, or the room edge — and divide by the requirement. The **minimum**
across faces, never the mean: a layout is only as good as its tightest clearance, and an average
would let a generous face hide one a service engineer cannot work in.

---

## Tests, and the six that could not fail

54 unit tests. Every guard was broken and the failure observed:

| Guard | Broken by | Result |
| --- | --- | --- |
| Gate 1 rejects too many | `>=` instead of `===` | 1 fails |
| Gate 2 rejects violations | Returning no rejection | 3 fail |
| Gate 2 does **not** reject YELLOW | `!== 'GREEN'` | 7 fail |
| Candidate order is stable | A clock-dependent comparator | 1 fails |
| Packing uses the design footprint | Manufacturer dimensions | 1 fails |
| Containment tests corners | Centre only | 1 fails |
| Obstructed slots are filtered | Removing the filter | 1 fails |
| **Unavailable never becomes zero** | Substituting 0 | **9 fail** |
| **Per-station references scale** | Removing the scaling | 1 fails |
| **`measuredOnly` contributes nothing** | Using the stated weight | 1 fails |
| **Coverage reports what was measured** | Hard-coding 1 | 4 fail |
| **Routing avoids obstructions** | Straight-line Manhattan | 1 fails |
| **Margin takes the worst face** | Using the mean | 1 fails |
| **Margin sees blockers** | Never blocking the probe | 1 fails |
| Ranking returns alternatives | Returning only the best | 1 fails |

**Six tests did not fail on the first attempt.** Four are recorded above from step 3; step 4 added
two more, and both were untestable for the same underlying reason — *the fixture never reached the
code*:

5. *"A measured-only criterion contributes nothing"* was asserted against the shipped model, where
   `drain_routing`'s weight is already 0 — so the guard was multiplying by a zero that was there
   anyway. Fixed by constructing the half-an-edit case (weight 0.3 with the flag left behind), and
   then again by moving the drain point nearer: at its usual corner the routed run exceeded the
   reference and `normalised` clamped to 0, so the product was zero for a second unrelated reason.
6. *"Compliance margin takes the worst face"* never ran at all: with no thresholds in the rule set
   the criterion returns `unavailable` before reaching any arithmetic. It needed a fixture rule
   carrying a real threshold — kept deliberately **out** of the default rule set, so the default
   fixture keeps reflecting the product's actual A-1 state.

### And one real bug the tests caught

An **empty room scored 1.00.** Future expansion is the only criterion needing neither a reference
point nor a threshold, and an empty room has the most expansion room of all — so a blank drawing
came out as a perfect layout at 0.05 coverage. That is the emptiest-room failure, kept out of the
weighted sum by making station count a constraint, creeping back through a criterion that improves
as the room empties. It now reports `unavailable` with no placements: *"how many more fit"* needs a
layout to be more than.


---

## Optimisation (step 5)

`rankLayouts` answers *"what would a good layout look like?"*. `optimiseLayout` answers *"is the
arrangement I already have improvable?"*, and the difference is not cosmetic:

| | Propose | Optimise |
| --- | --- | --- |
| Starting point | An empty room | **An engineer's decision** |
| Station count | The target, or as many as fit | **Immutable — the count already placed** |
| Commands | `placement.create` | `placement.move` / `.rotate` only |
| Answer when nothing is better | Three layouts | **`already_best`** |

### `placement.delete` is impossible, not merely forbidden

Removing a machine improves nearly every criterion — clearance margin, maintenance access, every
routing distance, expansion room. It is the cheapest way for an optimiser to look effective, and
what it produces is a layout with fewer stations than the hospital asked for.

So the count is fixed by construction: candidates are generated at exactly the count already placed,
and commands come from **assigning existing placements to new positions** — a permutation, which has
nowhere for a deletion to appear. `assertNoDeletions` then checks the output anyway, because a
structural guarantee that nothing asserts holds only until the next refactor.

Assignment is nearest-first, so each machine keeps its id, its label and its catalogue reference and
only its transform changes. An accepted proposal reads as *"station 4 moved 300 mm"* in the history
rather than as a machine vanishing and a different one appearing.

### Four outcomes, and three of them are not proposals

| Outcome | Means |
| --- | --- |
| `improved` | Some arrangement beats the current one |
| `already_best` | **Nothing does.** The engineer's layout is the best this solver can construct |
| `no_feasible_candidate` | Nothing passes the gates at all — different from "nothing is better" |
| `not_optimisable` | Nothing is placed. An empty layout is not a candidate |

`already_best` is the answer an optimiser is most tempted to avoid. Returning the best of a worse
bunch would make every run produce a suggestion, and an engineer who accepted one would have been
talked into a worse layout by a tool that had nothing to offer.

### Guards verified by breaking them

| Guard | Broken by | Result |
| --- | --- | --- |
| Never emits `placement.delete` | Delete + create instead of move | 4 fail |
| An empty layout is not a candidate | Removing the guard | 1 fails |
| Only proposes what beats the current | Returning all ranked layouts | 1 fails |
| Count comes from what is placed | Using `target + 1` | 1 fails |
| Nearest-target assignment | Index-order pairing | 2 fail |
| Current scored on the same inputs | Dropping its reference points | 4 fail |
| Current reports its own target | Passing `null` | 1 fails |

One of those tests could not fail at first: *"scores the current layout on the same model"* compared
a `scoringModel` object passed to **both** sides, so it was trivially equal. What can actually differ
is the *inputs* — score the current layout without the reference points the candidates were scored
with and its coverage drops, making the two totals incomparable while both still read 0…1. The
assertion is now on coverage and on the reported constraint.
