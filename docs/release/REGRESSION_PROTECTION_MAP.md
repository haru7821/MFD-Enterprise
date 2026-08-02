# Regression Protection Map

> **VantiCAD Layout** · Evidence-First Layout Decision Support

> Companion to [`RELEASE_READINESS_REPORT.md`](RELEASE_READINESS_REPORT.md), at commit `cea0f54`.
>
> The conditions for leaving Release Candidate are in [`RELEASE_GATE.md`](RELEASE_GATE.md).
>
> For each design decision: where it lives, what guards it, and **what a failure of that guard
> means**. The third column is the one worth having — a red test whose meaning nobody can state is a
> red test somebody will delete.

Every path below was checked to exist while writing this.

---

## Evidence and abstention

| Decision | Source | Test | A failure means |
| --- | --- | --- | --- |
| **D1** — no renormalised total; suppress ranking below `minimumCoverage` | `packages/ai-local/src/score.ts` | `packages/ai-local/src/score.test.ts` | Deleting evidence can raise a score. This was measured at a perfect 1.0000 on coverage 0.20. |
| **D3** — clearance abstains rather than reporting clear past walls | `packages/rule-engine/src/evaluators/clearance.ts` | `packages/rule-engine/src/evaluators/boundary.test.ts` | The engine reports GREEN for a face it never measured. |
| **D4 / D8** — `compliance_margin` and `maintenance_access` abstain on a non-rectangular room | `packages/ai-local/src/criteria.ts` | `packages/ai-local/src/score.test.ts` | A bounding box is being used as the room. Measured at a 9.6× over-report on an L-shaped room. |
| **D5** — an unevaluable placement makes the level Inconclusive | `packages/rule-engine/src/evaluate.ts` | `packages/rule-engine/src/result.shape.test.ts` | A level PASSes while one of its placements was never evaluated. |
| Containment, collision and clearance stay independent | `packages/rule-engine/src/evaluators/` | `packages/rule-engine/src/evaluators/independence.test.ts` | One question is answering another — the failure A-4 exists to prevent. |
| Unknown never becomes a measured zero | reason-code system | `packages/rule-engine/src/messages.test.ts`, `packages/rule-engine/src/result.shape.test.ts` | A criterion that could not be measured is scoring like a bad result. |

## Equality

| Decision | Source | Test | A failure means |
| --- | --- | --- | --- |
| **D2** — touching is not collision; one predicate everywhere | `packages/cad-engine/src/polygon.ts` | `packages/cad-engine/src/polygon.test.ts`, `packages/rule-engine/src/sat.test.ts` | Two subsystems disagree about whether contact is overlap. |
| **D6** — support counts independent facilities | `packages/layout-knowledge/src/provenance.ts` | `packages/layout-knowledge/src/knowledge.test.ts` | One firm's template reads as a consensus. Measured: 117 files, 24 sites. |
| **D15** — support counts plans, not files | `packages/layout-knowledge/src/aggregate.ts` | `packages/layout-knowledge/src/boundaries.test.ts` | A plan exported twice is counted as two sheets of evidence. |
| **D10** — a confirmation binds to the run's outcome | `packages/layout-knowledge/src/verification.ts` (`rowFingerprint`) | `scripts/lib/corpusLedger.test.ts` | A signature stays alive across a change in what the pipeline made of the same bytes. |
| `rowFingerprint` is injective | same | `scripts/lib/corpusLedger.test.ts` | A signature applies to a run it was not given for. One discrepancy containing the delimiters could impersonate two. |
| **Geometry identity** — same placements means same layout | `packages/ai-local/src/generate.ts` (`geometryKey`) | `packages/ai-local/src/rank.test.ts` (Case A/B/C) | The product claims to have found alternatives that are one arrangement. |

## Ranking and presentation

| Decision | Source | Test | A failure means |
| --- | --- | --- | --- |
| **D13 — tie semantics** | `packages/ai-local/src/rank.ts` (`denseRanks`) | `packages/ai-local/src/rank.test.ts`, `tests/e2e/layout.spec.ts` | Alphabetical order is being presented as engineering preference. |
| **D1 — a suppressed total sorts last, and is not a zero** | `packages/ai-local/src/rank.ts` (`compareLayouts`) | `packages/ai-local/src/rank.test.ts` | The engine offers "could not measure" as its best answer, or ranks it level with a layout that genuinely scored 0. Both mutants (`?? 2`, `?? 0`) were green before this row existed. |
| **Geometry convergence collapses** | `packages/ai-local/src/rank.ts` (`collapseByGeometry`) | `packages/ai-local/src/rank.test.ts` Case A | Duplicates are being labelled *Tied*, which says the evidence cannot separate two things when there is one. |
| Convergence evidence is preserved | `RankedLayout.strategies` | `packages/ai-local/src/rank.test.ts` Case A | The fact that two strategies independently agreed has been thrown away. |
| `already_best` claims only what it compared | `packages/ai-local/src/optimise.ts`, `apps/web/src/features/layout/LayoutPanel.tsx` | `packages/ai-local/src/optimise.test.ts`, `tests/e2e/layout.spec.ts` | The drawing is told it "scores highest" when an arrangement ties it. |
| `placement.delete` is never proposed | `packages/ai-local/src/optimise.ts` | `packages/ai-local/src/optimise.test.ts` | The optimiser is improving the score by removing a machine the hospital asked for. |

## Explanation and language

| Decision | Source | Test | A failure means |
| --- | --- | --- | --- |
| `AR-105` names every converging strategy | `packages/ai-local/src/rank.ts` (`explain`) | `packages/ai-local/src/rank.test.ts` Case B | The explanation names one strategy and silently drops the others. |
| Canonical strategy order is declared | `packages/ai-local/src/rank.ts` (`compareStrategies`) | `packages/ai-local/src/rank.test.ts` Case C | Wording depends on the `candidate.id` string format. |
| **D16** — the `strategies` array is ordered as the sentence is | `packages/ai-local/src/rank.ts` (`collapseByGeometry`) | `packages/ai-local/src/rank.test.ts` Cases A and B | The exported field and the sentence built from it name the same strategies in different orders, and a consumer has to pick which of our statements to believe. |
| Korean 와/과 is computed from the syllable | `packages/ai-contract/src/rationale.ts` | `packages/ai-contract/src/korean.test.ts` | A wrong particle is printed, or a strategy renamed in future takes the wrong one. |
| Every finding is bilingual | `packages/rule-engine/src/messages.ts` | `packages/rule-engine/src/messages.test.ts` | One language is missing and the other reads as the whole answer. |
| No claim word exceeds the evidence | user-facing strings | `tests/e2e/layout.spec.ts` | The product is telling an engineer something it did not measure. |

## Determinism

| Decision | Source | Test | A failure means |
| --- | --- | --- | --- |
| No `localeCompare` in shipped code | repo-wide | `tests/architecture/determinism.test.ts` | A committed artefact's bytes depend on the machine's locale. Measured at 171 changed lines. |
| One clock boundary, no randomness | `apps/web/src/editor/clock.ts` | `tests/architecture/determinism.test.ts` | A re-run differs from the run before it. |
| Every tracked test is collected | `vitest.config.ts` | `tests/architecture/everyTestIsCollected.test.ts` | A test file exists and never runs — indistinguishable from one that always passes. |
| Artefacts match their generators | `scripts/extract-observations.ts` | `tests/architecture/artefactsMatchTheirGenerators.test.ts` | A committed artefact and the code that writes it have drifted apart. This happened for two commits. |
| Shuffled input, identical output | knowledge, ledger, solver | `tests/architecture/replay.test.ts` | A `Map`'s insertion order is reaching an engineer. |
| `Date.parse` orders every accepted instant | `packages/layout-knowledge/src/verification.ts` | `packages/layout-knowledge/src/instantOrder.test.ts` | The wrong signature is recorded as the one that applies. |

## Artefact integrity

| Decision | Source | Test | A failure means |
| --- | --- | --- | --- |
| **D7** — batch execution is not completion | `packages/layout-knowledge/src/verification.ts` | `packages/layout-knowledge/src/verification.test.ts` | A machine reaching its own last stage is recorded as the programme being complete. |
| **D9** — confirmations live where no batch writes | `scripts/lib/corpusLedger.ts` | `scripts/lib/corpusLedger.test.ts` | A person's signature is destroyed by the next run. |
| **D11** — a duplicate confirmation is reported, never dropped | `packages/layout-knowledge/src/verification.ts` | `scripts/lib/corpusLedger.test.ts` | A second signature vanishes uncounted. |
| **D12** — a confirmed stop is never counted as completion | `packages/layout-knowledge/src/verification.ts` | `packages/layout-knowledge/src/verification.test.ts` | A correctly diagnosed failure to read a drawing reads as progress towards reading it. |
| **D14** — no empty `frequencies` | `packages/layout-knowledge/src/aggregate.ts` | `packages/layout-knowledge/src/knowledge.test.ts` | An unmeasured field reads as a measurement that found nothing. |
| Published figures re-derive independently | `packages/layout-knowledge/src/aggregate.ts` | `packages/layout-knowledge/src/figuresAreDerivable.test.ts` | A *rule* changed and the artefact moved with it, both green. The regeneration test alone cannot catch this. |
| Every figure cites a catalogued drawing | same | same | A number's evidence points at a file that no longer exists. |

---

## Guards that cannot currently fail

Listed because a map that omits them would overstate its own coverage. Each is kept for a reason and
each is labelled at its definition; see
[`RELEASE_READINESS_REPORT.md`](RELEASE_READINESS_REPORT.md) §9.4.

**One entry was removed from this table because the claim was wrong, and how it was wrong is worth
keeping.** The strategy-list sort was listed as unkillable on the evidence that *deleting* it left
the suite green — which it does, because `candidate.id` begins with the strategy name. But
**reversing** it fails two tests: the sort's output is pinned even though its presence is not. The
mutation chosen decided the answer, and the weaker mutation was the one that flattered the code.
A guard is dormant only if no mutation of it can be caught, and "I deleted it and nothing happened"
does not establish that. It now sits in the live rows above, under D16.

| Guard | Why it cannot fail today |
| --- | --- |
| `compare`'s compliance-margin key | Every margin is unavailable (A-1). A test fails the day one is not. |
| `compare`'s candidate-id key | `candidates.ts` already emits in id order and `Array.sort` is stable. |
| `ordered()` **or** `drawingsOf`'s sort — either alone | Mutually redundant. Deleting **both** fails five tests. |
| `tally`'s tie-break, on real data | 211 / 80 / 15 are distinct counts. Covered by a constructed tie. |
| D8's rectangularity guard, on the shipped catalogue | `SC-904` fires first, every time. Covered by a fixture object that declares clearances. |
