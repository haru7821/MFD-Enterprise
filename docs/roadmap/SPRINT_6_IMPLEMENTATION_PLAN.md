# Sprint 6 — Implementation Plan

> **Approved. Implementation in progress.**
> Sprint 6 — AI Engineering Assistant.
>
> **Revision 3** — B-5a's weights are decided and in `standards/scoring/dialysis.json`, so step 4 has
> its numbers. Two reconciliations the weight table required are recorded in § B. Step 2's entity is
> renamed `ReferencePoint` and gains two kinds, because two of B-5a's criteria measure from a goods
> entrance and a nurse base.
>
> **Revision 2**, for the owner's four decisions. Three of them add components, and the plan grew
> accordingly — from seven steps and 18 days to ten steps and 30. The growth is real work, not
> padding, and § D says where every day went.
>
> | # | Decision | Effect on this plan |
> | --- | --- | --- |
> | 1 | Knowledge retrieval before any LLM reasoning | **Step 8 is new** and now gates steps 9–10 |
> | 2 | An Installation Planner Agent | **Step 6 is new** — `packages/ai-planner` |
> | 3 | A weighted scoring engine, configurable | **Steps 2 and 4 are new**; step 5's ranking is rewritten |
> | 4 | The solver maximises total engineering score | B-5 closes; B-5a opened, and is now decided too |
>
> [AI_SYSTEM_ARCHITECTURE.md](../architecture/AI_SYSTEM_ARCHITECTURE.md) ·
> [AI_SERVICE_API.md](../architecture/AI_SERVICE_API.md) ·
> [AI_WORKFLOW.md](../architecture/AI_WORKFLOW.md) ·
> [AI_PROMPT_GUIDELINES.md](../architecture/AI_PROMPT_GUIDELINES.md)

---

## A. The plan in one paragraph

**Six of the nine features need no language model.** Build those first, deterministically, in
TypeScript, with the rule engine as the oracle — they ship whatever the answer to data residency turns
out to be. Then the knowledge engine, which needs an index but no model. Then the language half behind
the same interface, so the application works without it. The report engine gains no parameter and
`packages/` gains no AI dependency; if either happens, the boundary leaked and the sprint is wrong.

Revision 2 moved the balance further in that direction: scoring and planning both landed in the
browser, so the deterministic half is now two thirds of the sprint rather than half.

---

## B. What is settled, and what blocks what

| | |
| --- | --- |
| **Settled** | The mission is engineering decision support. No LLM in business logic. An AI service layer behind stable interfaces. **Retrieval precedes reasoning.** **The solver maximises a weighted engineering score.** An installation planner is in scope. |
| **Approved** | The architecture, at revision 2, plus the B-5a weights. **Implementation has started.** |
| **Blocks the language half** | **B-4** — may project data leave the hospital network? |
| **Closed by decision 3** | **B-5** — what makes one satisfying layout better than another. |
| **Closed by the owner** | **B-5a** — the default engineering weights. |
| **Open, blocks nothing** | **B-5b** — the normalisation *references*, which are still a developer's estimate. |
| **Blocks nothing here, still blocks the product** | **A-1** — the AK98 manual. |

### B-5 is closed, and the placeholder is deleted rather than kept

Revision 1 shipped station-count maximisation because B-5 was open. Decision 3 answers it: weighted
criteria, configurable. The station-count comparator is **removed**, not retained behind a flag — a
solver with two ranking modes produces output that depends on which mode somebody left selected, and
that is not reproducible in the sense this product needs.

### B-5a is decided, and two parts of it needed reconciling

The approved weights are in
[`standards/scoring/dialysis.json`](../../standards/scoring/dialysis.json) at version 1.0.0:
compliance 40, feasibility 20, maintenance 15, RO 10, electrical 5, expansion 5, walking 5. Two of
those criteria are new and are defined in the architecture; two criteria from B-5's list are absent
from the weight table and are handled explicitly rather than dropped:

| | |
| --- | --- |
| `drain_routing` | Measured at **weight 0** and printed in every breakdown. Weightable by changing one number. |
| `station_count` | A **constraint**, not a zero-weight criterion. Interpreted rather than transcribed, and flagged to the owner. |

The station-count reasoning matters for step 4's implementation, so it is here as well as in the
architecture: every other criterion improves as machines are removed, so at weight 0 station count
would not sit out the ranking, it would win it. A one-station room scores 1.00 against a
twelve-station room's 0.65. So the target is a constraint on the candidate set, and `optimise_layout`
may never emit `placement.delete`.

Also decided: **the UI must never show a bare total.** Enforced in `ai-contract`'s schema — a
`ScoreBreakdown` with a total and no criteria is invalid — so no renderer can be written that has only
a total to show.

### Four weighted criteria need geometry the document does not have

Installation feasibility, RO piping, electrical routing and walking distance are distances *from
somewhere* — **40 % of the approved model.** The document has no somewhere. So **step 2 adds
`Level.referencePoints` and `DOCUMENT_VERSION` 4** with a real 3 → 4 migration, and until an engineer
places the points those criteria report `unavailable` — never zero, because zero is a perfect score
for a criterion that minimises (AD-18).

B-5a raised the stakes on this from three criteria to four and from 25 % of the model to 40 %, which
is what makes `ScoreBreakdown.coverage` necessary rather than tidy: a total computed over 60 % of the
model reads the same as a complete one.

This is the kind of thing that is cheap now and expensive in step 4. Finding out mid-solver that four
of the eight criteria are unmeasurable would have produced exactly the silent default the rest of this
codebase exists to prevent.

### B-4 is still the only real gate, and it now gates less

| If | Then |
| --- | --- |
| Data may not leave the network | Steps 1–7 ship. **Six** features work. Steps 8–10 wait for an on-premises deployment decision. |
| Data may leave | All ten steps ship. |
| Self-hosted model and index | All ten steps ship; only `apps/ai-service` configuration differs. |

**I would rather start on the answerable half than wait**, and I would like the plan approved on that
basis: steps 1–7 are 21 days, useful, shippable, and unaffected by B-4.

---

## C. Order of work

Ten steps. Each ends green, and each is useful on its own.

### Step 1 — `packages/ai-contract` (≈3 days) ✅ **Done**

| Files | |
| --- | --- |
| `src/client.ts` | `AiClient`, `AiCapability` — including `score`, `plan`, `retrieve` |
| `src/requests.ts` | Every request type, with `GroundingBundle`, `ReferencePointSummary`, `ScoringModel`, `planImage?: never` |
| `src/responses.ts` | `AiProposal`, `ScoreBreakdown`, `InstallationPlan`, `RetrievalResult`, `AiExplanation`, `AiAnswer`, `AiSummary`, `Citation` |
| `src/scoring.ts` | `SCORING_CRITERIA`, `CriterionConfig`, the normalisation function |
| `src/schema.ts` | Zod schemas: bilingual, citation, **retrieval non-empty**, breakdown arithmetic, plan acyclicity |
| `src/rationale.ts` | `AR-` codes, bilingual, exactly like the rule engine's reason codes |
| `src/validate.ts` | `validateResponse` — the four checks of AI_SERVICE_API § E |
| Tests | Shape locks, all four validation checks, breakdown arithmetic, cycle rejection |

**Why first, and why it contains no AI.** It is the vocabulary all three implementations speak, and the
validator is what makes the language half safe. Writing it before any implementation means none can
quietly widen it.

**Done when** each of these is rejected, and **each rejection is verified by making the check fail**: a
response with an uncited number; a response missing Korean; a citation naming an absent rule; **a
language response with an empty `retrieved` array**; **a `ScoreBreakdown` whose `total` does not equal
the sum of its contributions**; **a plan with a dependency cycle**.

### Step 2 — reference points, `DOCUMENT_VERSION` 4 (≈2 days) ✅ **Done**

| Files | |
| --- | --- |
| `packages/document-model/src/schema.ts` | `ReferencePoint`, `Level.referencePoints`, `DOCUMENT_VERSION = 4` |
| `src/migrate.ts` | 3 → 4: existing levels gain an empty array |
| `src/commands.ts` | `referencePoint.create` / `.move` / `.relabel` / `.delete`, undoable like every other command |
| `apps/web/.../ReferencePointPanel.tsx`, `ReferencePointLayer.tsx` | Arm a kind, click to place, name it, delete it; drawn as a screen-sized crosshair |
| `packages/report-engine` | Points on the floor plan and in a table — **and the absence stated** when a level has none |
| Tests | Migration round trip, command undo, the report renders points, 8 browser specs |

**Why a separate step, and why before the scoring engine.** Four weighted criteria are unmeasurable without it,
and a document-version change is the kind of work that must not be squeezed alongside a solver. The
migration is real — a version bump with no data change would be dishonest about what version 4 means.

**Done when** a version-3 document opens, migrates, gains points, saves as version 4, and reopens with
them; and when a level with no points produces a report that says so rather than implying zero.

**Done.** Both hold, and each was verified by making it fail: breaking the migration to do nothing
fails four tests, and seeding it with a guessed drain point fails two — including the one that exists
purely to stop that. On the report side, suppressing the empty-state sentence fails a unit test and a
browser spec.

One thing found on the way and fixed rather than left: the tool registry's `availableFrom` claimed
`measure` was usable from Sprint 5. Sprint 5 delivered the report engine and nothing measures, so
moving the sprint counter to 6 would have enabled a button that does nothing — the exact dishonesty
the registry's own docstring warns about, arriving through a number nobody re-checked. The field is
now `number | null`, and `measure` is `null`: wanted, not scheduled.

### Step 3 — the solver's geometry and candidates (≈3 days)

| Files | |
| --- | --- |
| `packages/ai-local/src/candidates.ts` | Position generation: grid, wall-aligned, row-packed |
| `src/constraints.ts` | Rule-engine evaluation per candidate — **the filter** |
| `src/place.ts` | `proposePlacement` — one machine |
| Tests | Determinism, RED-rejection, the no-legal-position case |

**Done when** the same room produces the same three proposals twice, a candidate breaking a RED rule is
*absent* rather than ranked low, and a room too small produces "no position satisfies the rules" naming
the binding constraint.

### Step 4 — the weighted scoring engine (≈3 days)

| Files | |
| --- | --- |
| `packages/ai-local/src/criteria/*.ts` | One measurement per criterion: compliance margin, station count, RO run, drain run, electrical run, maintenance access, expansion area |
| `src/route.ts` | Manhattan-ish routed distance from a reference point, respecting obstructions |
| `src/normalise.ts` | Measurement → 0…1 against `CriterionConfig.reference` |
| `src/score.ts` | `scoreLayout` → `ScoreBreakdown`, including `unavailable` |
| `standards/scoring/dialysis.json` | The default model. **Weights flagged as B-5a.** |
| Tests | Per-criterion measurement, normalisation bounds, renormalisation over available criteria, `unavailable` never zero |

**Done when** a layout scores identically twice; a layout with no reference points reports three
criteria `unavailable` and a total over the remaining four; and **the `unavailable`-is-not-zero property
is verified by making it fail** — substitute zero for a missing RO run and confirm the ignore-the-services
layout wins, then restore it.

That last check is the one worth the effort. It is the failure the owner's decision could most easily
produce by accident: a weighted sum is exactly the kind of arithmetic in which a missing input silently
becomes an advantage.

### Step 5 — room layout and optimisation, ranked by score (≈3 days)

| Files | |
| --- | --- |
| `src/layout.ts` | `proposeLayout` — pack a room |
| `src/optimise.ts` | `optimiseLayout` — improve an existing arrangement, ranked by total score |
| Tests | Whole-arrangement evaluation; the improvement is stated per criterion; nothing settled moves unasked |

**The trap this step exists to avoid:** twelve individually legal positions can be collectively
illegal — clearance envelopes overlap, a bed route disappears, the last station blocks the door. The
evaluation is of the finished arrangement.

**The trap revision 2 adds:** the highest-scoring layout is not necessarily the most stations, and the
interface must not quietly reorder them by count because that looks more impressive. **Done when** a
fixture exists in which a thirteen-station layout outranks a fourteen-station one, and the breakdown
shows why.

### Step 6 — `packages/ai-planner` (≈3 days)

| Files | |
| --- | --- |
| `standards/sequences/dialysis.json` | Stages and declared dependencies. **Data.** |
| `src/stages.ts` | Instantiate stages only where the project has something for them |
| `src/order.ts` | Topological sort; a cycle is an error naming the stages in it |
| `src/blockers.ts` | Open RED findings, missing origins, absent prerequisites |
| `src/plan.ts` | `planInstallation` → `InstallationPlan` |
| `packages/report-engine` | The plan as an ordered section, reusing the existing checklist item ids |
| Tests | Order stability, cycle rejection, blocker collection, checklist ids resolve |

**Done when** the same project produces the same order twice; a cyclic sequence set is rejected with the
cycle named; a plan for a layout with a RED finding leads with the blocker; and **every commissioning
item in the plan is an id that exists in the report's checklist** — verified by removing one from the
standards file and watching the test fail.

**No durations.** `InstallationStage` declares `durationDays?: never`, so this is enforced by the
compiler rather than by remembering (AD-19).

### Step 7 — the assistant panel, proposal review, plan view (≈4 days)

| Files | |
| --- | --- |
| `apps/web/src/features/assistant/AssistantPanel.tsx` | The panel |
| `.../ProposalReview.tsx` | Ghosted geometry, before/after findings, **the score breakdown**, accept or discard |
| `.../ScoreBreakdownTable.tsx` | Per criterion: measured, normalised, weight, contribution; `unavailable` with its reason |
| `.../InstallationPlanView.tsx` | Stages, dependencies, blockers, sign-off items |
| `.../useProposals.ts` | Client wiring, capability gating |
| `.../compositeClient.ts` | Routes per capability across the three implementations |
| `tests/e2e/assistant.spec.ts` | A1–A9 |

**Done when** an engineer can ask for a position, see three proposals with their rule-engine
consequences *and* their score breakdowns, accept one, undo it in a single step, score their own
layout, and open an installation plan — **with no AI service configured at all.**

**That last clause is the acceptance criterion for the whole architecture.** If step 7 needs a service,
the boundary leaked.

### Step 8 — the knowledge engine (≈4 days)

| | |
| --- | --- |
| `apps/ai-service` FastAPI skeleton, `POST /v1/retrieve` | |
| Ingestion: document → passages, **quoted not summarised**, with document / revision / section / page | |
| Index: BM25 and vector, results merged and ranked; a relevance floor below which nothing is returned | |
| `RetrievalResult.empty` and `searched`, so an answer can never imply coverage the index lacks | |
| Contract-version check; a mismatch is refused, not tolerated | |
| **No model call anywhere in this step** | |

**Why it is a step of its own, and why before any prompt.** Decision 1 makes retrieval a *stage* rather
than a feature, so three later features are unreachable without it. Building it alone means the first
real model call is debugging one thing.

**Done when** an indexed manual answers a query with a locatable citation and a model key is not
configured; and when a query the corpus does not cover returns `empty: true` — which is the whole
mechanism behind the retrieval-first rule.

### Step 9 — explanation and query, retrieval-first (≈3 days)

| | |
| --- | --- |
| `prompts/` with the AUTHORITY block (including the memory clause), the `PASSAGES` block, the refusal format | |
| The **prompt builder that cannot run without passages** — § A-2 of the prompt guidelines | |
| The **classifier**: structured questions answered from findings, never sent to a model | |
| Evaluation sets: golden, refusal, **empty-retrieval**, **distractor**, **memory**, injection, bilingual | |

**Done when** the golden set's citation sets are stable across runs; every citation resolves to a
retrieved passage or a FACTS key; the refusal set returns `insufficientGrounding` with no invented
figures; the **memory set refuses** rather than producing the remembered figure; and the injection set
does not follow an instruction typed into a room name *or* embedded in a retrieved passage.

The memory set is the direct test of the owner's decision and I expect it to be the one that finds
problems. A model stating a correct-but-unretrieved figure is a failure, and it is the failure a
validator cannot catch on its own.

### Step 10 — recommendations and summarisation (≈2 days)

| | |
| --- | --- |
| Ranked recommendations: RED, uncited groups, uncalibrated levels, **unmeasurable criteria**, checklist items, then model suggestions marked as such | |
| Report summarisation **into the panel** — never into the report | |
| Documentation, CI, the Sprint 6 review | |

---

## D. Estimate

| Step | Days | Needs B-4 | New in rev 2 |
| --- | --- | --- | --- |
| 1 · `ai-contract` | 3 | No | +1 day (scoring, plan, retrieval types) |
| 2 · Utility origins, `DOCUMENT_VERSION` 4 | 2 | No | **New** |
| 3 · Solver candidates | 3 | No | |
| 4 · Weighted scoring engine | 3 | No | **New** |
| 5 · Layout and optimisation | 3 | No | Ranking rewritten |
| 6 · `ai-planner` | 3 | No | **New** |
| 7 · Panel, proposal review, plan view | 4 | No | +1 day (breakdown table, plan view) |
| 8 · Knowledge engine | 4 | Yes | **New** (absorbs the old step 5 skeleton) |
| 9 · Explanation and query | 3 | Yes | Retrieval-first; three more evaluation sets |
| 10 · Recommendations, summarisation | 2 | Partly | |
| **Total** | **30 working days** ≈ 6 weeks | | was 18 |

**Steps 1–7 are 21 days and deliver six of the nine features.** If B-4 comes back "data may not
leave", that is the sprint, and it is a better one than revision 1's equivalent: scoring and planning
are the two features an engineer will use daily, and neither needs a network.

Two steps I expect to slip, for different reasons:

- **Step 4**, because routed distance is where geometry gets fiddly. A straight line from an origin to
  a machine is easy and wrong — it ignores walls. The routing quality determines whether three of the
  criteria mean anything.
- **Step 9**, because prompt evaluation is not finished when it works once. The citation-stability and
  memory sets are what will take the time, and they are the tests that decide whether the feature can
  be trusted.

---

## E. Test budget

| | Added |
| --- | --- |
| Unit suites | ~17 (`contract.shape`, `validate`, `rationale`, `migrate.v4`, `candidates`, `constraints`, `route`, `normalise`, `score`, `criteria`, `layout`, `optimise`, `stages`, `order`, `blockers`, `classifier`, `recommend`) |
| Unit tests | ~150 |
| Browser specs | 9 (A1–A9) |
| Prompt evaluation sets | 7 (golden, refusal, empty-retrieval, distractor, memory, injection, bilingual) |

Seven checks to be **verified by making them fail**, chosen because each guards a claim rather than a
mechanism:

| Check | How it will be broken |
| --- | --- |
| A proposal breaking a RED rule is never offered | Remove the rejection and confirm a red candidate appears |
| An uncited number is rejected | Hand-write a response with a bare figure |
| **A language response with no retrieved passages is rejected** | Hand-write a well-formed answer with `retrieved: []` |
| **An unmeasurable criterion is never scored as zero** | Substitute zero for a missing RO run; the ignore-the-services layout should win, and does |
| **A plan's commissioning items resolve to the report's checklist** | Remove an item from the standards file |
| The application works with no AI service | Configure none and run the whole browser suite |
| A prompt-injected instruction is not followed | Name a room with an instruction; then put one in a retrieved passage |

The "works with no AI service" check is the architecture's own test, and it belongs in CI: **`pnpm
test:e2e` with no AI service configured must pass in full.** Not as a special case — as the default.

The two new ones worth arguing for: the zero-substitution check is the only way to know the weighted sum
cannot reward a missing measurement, and the checklist-resolution check is what stops the planner
growing a second commissioning list that can disagree with the signed report.

---

## F. Risks

| Risk | Handling |
| --- | --- |
| **The model becomes an authority by accident** | Four layers now: no prompt without retrieved passages, uncited numbers rejected, citations must resolve to a retrieved passage, sourced values rendered from the source. `packages/` cannot import an AI client. A prompt instruction is a request, not a constraint. |
| **Weighting purchases a violation** | Compliance is a *filter* applied before scoring (AD-17). Only margin is weighted. Verified by a fixture in which no weight configuration makes a violating layout appear. |
| **A missing measurement becomes an advantage** | `unavailable`, never zero (AD-18), verified by making the check fail. The single most likely way decision 3 could go wrong. |
| **The default weights are mine, not an engineer's** | B-5a, flagged as an open question, with the per-criterion breakdown shown on every proposal so they can be argued with rather than trusted. |
| **B-4 is answered "no"** | Steps 1–7 ship regardless. Six features, no service. |
| **A thin corpus makes the language features useless** | It makes them *absent*, which is visible, rather than wrong, which is not. Index coverage becomes a measurable property: how many rules and equipment objects have a retrievable citation. |
| **The planner invents a schedule** | `durationDays?: never`. Enforced by the compiler. |
| **Routed distance is wrong rather than absent** | The riskiest silent failure in step 4: a plausible number from bad routing is worse than `unavailable`. Routing gets its own test suite with hand-computed expectations on fixture geometry. |
| **The solver is too slow to feel interactive** | Candidate generation is bounded and the rule engine is ~6 ms per level at fifty machines. Scoring adds seven measurements per candidate — measured before the panel is built, not after. |
| **Prompt drift** | Versioned prompt files, citation-stability tests, a review checklist with objective questions. |
| **Scope creep into agentic editing** | Explicitly out. One reviewable proposal at a time; a sequence of self-directed edits is not auditable. |
| **An engineer trusts the assistant's prose over the findings** | The facts render first and stay if the explanation never arrives. Model suggestions are visually separated from findings. |

---

## G. Not in Sprint 6

Auto-applied changes · generated prose in the signed report · fine-tuning on customer projects ·
agentic multi-step editing · voice or image input · a second language beyond Korean and English ·
routing and automatic layout as *unsupervised* features (the proposals are supervised by
construction) · **installation durations, dates or a schedule** · **automatic utility-origin
detection from a plan raster** (an engineer places them; inferring a panel location from a drawing
would be a measurement nobody took).

---

## H. Definition of done

1. An engineer can ask for a position, a room layout, or an optimisation, see proposals with their
   rule-engine consequences before and after **and their per-criterion score breakdowns**, accept one,
   and undo it in one step.
2. An engineer can score **their own** layout on the same model, and open an installation plan with its
   sequence, blockers and sign-off items.
3. **All of that works with no AI service configured.**
4. No layout that violates a rule can be proposed under any weight configuration, and no unmeasurable
   criterion is scored as zero.
5. No language response reaches the screen without a retrieved passage behind it, and every citation
   resolves to a passage or an engine field.
6. Every AI-originated numeric claim carries the id of the engine output or the passage it came from,
   and an unsourced one cannot reach the screen.
7. Language features are bilingual, and a response missing either language is rejected.
8. `buildReport` has gained no parameter for AI, and no package under `packages/` imports an AI client.
9. Typecheck, lint, unit tests and both CI workflows green, with the browser suite passing with no
   service configured.

**Point 8 is the one that says whether the architecture held.** Points 3, 4 and 5 are the ones that say
whether the feature can be trusted — and points 4 and 5 are new, because decisions 1 and 3 each
introduced a way for this to be quietly wrong.
