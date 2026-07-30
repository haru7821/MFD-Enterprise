# AI Workflow

> **Revised for review. Not implemented.**
> What an engineer actually does, feature by feature, and what happens underneath.
> Companion to [AI_SYSTEM_ARCHITECTURE.md](AI_SYSTEM_ARCHITECTURE.md) and
> [AI_SERVICE_API.md](AI_SERVICE_API.md).
>
> **Revision 2** — four owner decisions, and two of them change workflows that were already written
> here rather than adding new ones:
>
> | # | Decision | Effect on this document |
> | --- | --- | --- |
> | 1 | Retrieval before any LLM reasoning | § A gains a stage; §§ E, F, I are rewritten around it |
> | 2 | An Installation Planner Agent | New § G-2 |
> | 3 | A weighted scoring engine, seven criteria, configurable | **§ D replaced** — the B-5 workaround is gone |
> | 4 | The solver maximises total engineering score | § B and § C now carry a `ScoringModel` |

---

## A. The shape every AI workflow has

```
engineer asks ──► request assembled from named facts
                              │
        ┌─────────────────────┴──────────────────────┐
        │                                            │
  DETERMINISTIC                                  LANGUAGE
  solver · scoring · planner              ① KNOWLEDGE ENGINE retrieves
        │                                            │
        │                                   nothing found? ──► "not in the
        │                                            │          indexed corpus"
        │                                            │          (no model call)
        │                                   ② LLM reasons, over the
        │                                      passages and engine facts
        │                                            │
  a PROPOSAL: commands                      an ANSWER: text
  a SCORE: per-criterion breakdown                   │
  a PLAN: ordered stages                    validated: retrieval non-empty,
        │                                   every number cited, both languages
  editor applies to a COPY                           │
  runs evaluate()                            rendered with sourced values
  shows before / after                       from the engine
        │
  engineer accepts or discards
        │
  accepted → the same commands a
  gesture produces → undoable
```

Three invariants across every workflow below:

1. **The engineer decides.** Nothing is applied without an accept.
2. **The rule engine judges.** Every proposal is shown with its rule-engine consequences, computed
   locally, before and after.
3. **The model reads before it writes.** No language workflow reaches a model without passages in
   hand; a workflow with nothing retrieved ends at stage ① with an honest answer (AD-16).

Invariant 3 is decision 1, and it is worth noticing what it does to the shape: the *deterministic*
branch is now the wider one. Six of the nine features never enter stage ②.

---

## B. AI-assisted equipment placement

> *"Where does the next machine go?"*

| Step | What happens | Where |
| --- | --- | --- |
| 1 | Engineer selects a room and a catalogue item, clicks **Suggest position** | `apps/web` |
| 2 | Client assembles a `ProposalRequest`: room polygon, obstructions, existing placements, utility origins, **`ScoringModel`** | `apps/web` |
| 3 | Solver generates candidate positions on a grid, then refines | `ai-local` |
| 4 | **Each candidate is evaluated by `rule-engine`** — clearance, collision, boundary | `ai-local` |
| 5 | Candidates that violate a RED rule are discarded, not ranked low | `ai-local` |
| 6 | Survivors **scored over the seven criteria**; top three returned with their breakdowns | `ai-local` |
| 7 | Editor shows three ghosted positions with their findings and scores, before and after | `apps/web` |
| 8 | Engineer accepts one → `placement.create` command → undoable | `apps/web` |

**Step 5 is the design.** A candidate that breaks a RED rule is not a worse option, it is not an
option — offering it ranked fourth invites an engineer to take it because the interface presented
it as a choice. The proposal list is only ever positions that satisfy the rules the project is
being judged by.

**Step 4 is why this is not a language problem.** The oracle is the rule engine, which is exact,
pure and already trusted. A model asked to place a machine could not tell you whether its answer
satisfied the clearances, and a model asked to *check* would be a second opinion competing with an
authority.

**Steps 5 and 6 are two different mechanisms and must stay that way.** Step 5 is a filter over
compliance; step 6 is a weighted sum. A violation is never a low score — if it were, a high enough
weight elsewhere could outvote it, and the owner's seven criteria would have quietly become seven
ways to approve a non-compliant layout (AD-17).

### When every candidate fails

The honest outcome, and it must be a first-class one: *"no position in this room satisfies the
rules"*, with the binding constraint named — the clearance that could not be met, or the
obstruction leaving too little floor. That is a real engineering answer. Returning the least-bad
position with a warning would be the same failure as a report that says `review_required` when it
means `inconclusive`.

---

## C. Automatic room layout

> *"Fill this room with as many stations as it takes."*

Same pipeline, run over the room rather than one position:

| Step | |
| --- | --- |
| 1 | Engineer picks a room, an equipment type, and optionally a target count |
| 2 | Solver packs the room: rows against the long axis, clearance envelopes as exclusion zones |
| 3 | Every arrangement evaluated whole — a layout is not the sum of independently valid placements |
| 4 | Compliant arrangements **scored**; the best plus two alternatives returned |
| 5 | Engineer previews each as ghosted geometry with its findings and its score breakdown, accepts one |

**Step 4 is where "as many stations as it takes" stops being the whole answer.** The arrangement with
the most stations is one of the three offered, and it is not automatically first: a fourteen-station
layout with a 40 m RO run and no maintenance access loses to a thirteen-station one that is buildable.
That is decision 4, and it is the difference between packing a room and designing it.

**Step 3 is the trap.** Twelve individually legal positions can be collectively illegal: clearance
envelopes overlap, a bed route disappears, the last station blocks the door. So the evaluation is
of the finished arrangement, and the proposal carries that whole evaluation.

**Accepting a layout is one undo step**, via a command group. An engineer who accepts twelve
machines and changes their mind presses undo once. Twelve separate steps would be technically
truthful and practically unusable.

---

## D. Layout optimisation — the weighted scoring engine

> *"Can this room hold more, or hold the same and be better to build and maintain?"*
>
> Owner decision: *"Replace the current optimizer objective with a weighted scoring engine. … The
> solver must maximize total engineering score rather than station count only."*

**This section replaces the previous one.** Revision 1 shipped station-count maximisation as a
placeholder because [OPEN_QUESTIONS](../OPEN_QUESTIONS.md) B-5 was open. B-5 is now decided, and the
placeholder is deleted rather than kept alongside — a solver with two ranking modes is a solver whose
output depends on which one somebody left selected.

### The seven criteria

| Criterion | Unit | Direction | Measured how |
| --- | --- | --- | --- |
| Rule compliance *(margin)* | mm | maximise | Smallest headroom above any threshold, from `evaluate()` |
| Number of dialysis stations | count | maximise | Placements of station-class equipment |
| RO piping length | mm | minimise | Routed distance from `ro_supply` / `ro_return` origins |
| Drain routing | mm | minimise | Routed distance from the `drain` origin |
| Electrical routing | mm | minimise | Routed distance from the `electrical_panel` origin |
| Maintenance access | mm | maximise | Reachable service clearance per machine, worst case |
| Future expansion | mm² | maximise | Largest contiguous free area that could take another station |

### The workflow

| Step | | Where |
| --- | --- | --- |
| 1 | Engineer clicks **Optimise**, or **Score this layout** on their own arrangement | `apps/web` |
| 2 | Client loads the scoring model from `standards/scoring/dialysis.json`, overridden by project settings | `apps/web` |
| 3 | Candidates generated; **every one filtered against the rule engine first** | `ai-local` |
| 4 | Each surviving candidate measured on all seven criteria | `ai-local` |
| 5 | Criteria that cannot be measured reported `unavailable` — **never zero** | `ai-local` |
| 6 | Each measurement normalised 0…1 against its configured reference, then weighted | `ai-local` |
| 7 | Ranked by total; the engineer's own layout scored on the same model for comparison | `ai-local` |
| 8 | Proposal shows the total **and the per-criterion breakdown**, side by side with the current layout | `apps/web` |

### Rule compliance is a filter *and* a criterion, and they are not the same thing

The owner's list starts with "Rule compliance", and there are two readings:

| Reading | Treatment |
| --- | --- |
| *Does it comply?* | A **filter**. Applied at step 3, before any scoring. No weight, and no weight could change it. |
| *By how much?* | A **criterion** — `compliance_margin`, headroom above the requirement. Scored at step 4. |

Both are implemented, and separating them is the load-bearing part. A layout that violates a
clearance never reaches step 4, so no combination of weights can rank it first. What *is* weighted is
the difference between clearing a requirement by 5 mm and clearing it by 300 mm — which is real
engineering information, and which the previous station-count objective threw away.

### Step 2 exists because the weights are not ours to choose

The scoring model is data — `standards/scoring/dialysis.json`, versioned in git, referenced by id and
version in every `ScoreBreakdown`. Two consequences:

- A score is reproducible: the same layout, model and rule set produce the same total.
- The weights can be argued with. **They currently need to be**: the defaults I wrote are a
  reasonable-looking guess, not an engineering position, and they are the sprint's open question
  (see [OPEN_QUESTIONS](../OPEN_QUESTIONS.md) B-5a).

### Step 5 is the honest part

Three of the seven criteria measure distance *from a utility origin*, and the document has no utility
origins today — Sprint 6 adds `Level.utilityOrigins` at `DOCUMENT_VERSION` 4. Until an engineer places
them:

```
RO piping length      —  unavailable (no ro_supply origin placed)
Drain routing         —  unavailable (no drain origin placed)
Electrical routing    —  unavailable (no electrical_panel origin placed)
```

**Not zero.** Those three criteria minimise, so zero is a perfect score: defaulting to it would make
the layout that ignores every service run score highest, and the optimiser would confidently recommend
it (AD-18). `unavailable` is visible in the panel and in the report, and it is a prompt to place the
origins rather than a silent discount.

### What optimisation still refuses to do

| | |
| --- | --- |
| Never moves a machine that is already satisfying every rule, unless the engineer asks | A layout an engineer has settled is a decision, not a starting point |
| Reports the improvement per criterion | "One more station, 6 m less RO pipe, 120 mm less service clearance at station 4" — not "better" |
| Shows what it costs | Every optimisation trades something, and a weighted sum is exactly the mechanism that can hide it. The breakdown is what makes the trade visible. |
| Never presents a total without its criteria | A single number is unarguable-with; the criteria are where an engineer disagrees usefully |

---

## E. Rule explanation

> *"Why does the AK98 need 1,200 mm in front?"*

| Step | | Source |
| --- | --- | --- |
| 1 | Engineer clicks a finding in the validation panel | `apps/web` |
| 2 | The **facts** are shown first, from the engines: threshold, origin, citation, verification | `rule-engine` |
| 3 | **① Retrieval.** The rule's citation and the equipment's manual reference become a query; passages come back with document, revision and section | knowledge engine |
| 4 | **Nothing retrieved → stop.** The facts stay on screen; no explanation is offered | knowledge engine |
| 5 | **② Reasoning**, over those passages plus the facts — what this means for an installation | LLM |
| 6 | Every claim marked with the passage or engine field it rests on; the passages are shown alongside | validation |

**Order matters twice over.** The facts are visible before the explanation arrives, and remain if it
never does — an interface where the AI's paragraph appears first teaches an engineer to read the
paragraph, and the paragraph is the only part that can be wrong. And within the explanation, retrieval
precedes reasoning: the prose is *about* passages the engineer can also read, rather than about the
model's recollection of a manual.

**Step 4 is the case decision 1 changes.** Previously an unindexed rule still got an explanation —
fluent, plausible, and resting on nothing. Now it gets none, and the facts alone. That is a
capability *reduction* and it is the right one: an explanation of a clearance requirement, in a
document an engineer signs off from, is either grounded in the manual or it should not exist.

**What the explanation may add:** why a clearance exists at all (patient transfer, service
access), what commonly goes wrong, what to check on site — each traceable to a retrieved passage.
**What it may not add:** the figure, the verdict, whether the requirement is met, or anything the
corpus does not contain.

---

## F. Natural-language engineering queries

> *"Which stations are short of rear clearance?"* · *"What is outstanding on the fourth floor?"*

| Step | |
| --- | --- |
| 1 | Engineer types a question |
| 2 | The client **classifies** it: structured, or not |
| 3 | **Structured** questions are answered by querying the findings directly — no model, no retrieval |
| 4 | Everything else: **① retrieval**, over the indexed corpora |
| 5 | **Nothing retrieved → *"not in the indexed corpus"***, and the request ends there |
| 6 | **② reasoning**, over the passages plus the `GroundingBundle` the call site assembled |
| 7 | The answer is shown with its passages; an answer citing nothing is discarded before display |

**Step 3 is the important one.** "Which stations are short of rear clearance?" is a filter over
`EvaluationResult[]`, and answering it with a model would be slower, unreproducible, and capable
of being wrong about data the application already holds exactly. The classifier's job is to route
as much as possible away from the model.

That is a design choice with a cost: the classifier will misroute some questions, and a misrouted
structured question gets a vaguer answer than it deserved. The alternative — everything to the
model — is faster to build and produces an assistant that can be confidently wrong about the
project's own contents.

**Revision 2 collapses two of the three routes into one.** "Explanatory" and "retrieval" were separate
branches; they are now one pipeline, because a question that retrieves and then reasons *is* the
explanatory route. What remains is a two-way decision — does the application already hold the answer
exactly, or does it need a document? — and a two-way classifier misroutes less than a three-way one.

**Steps 5 and 6 answer two different questions, and the panel says which.** Retrieval covers
*published* documents; grounding covers *this project*. "What does the manual say about drain height?"
is answered from step 5's passages. "Is my drain compliant?" needs both, and the verdict still comes
from the rule engine rather than from either.

---

## G. Installation recommendation engine

> *"What should I be worried about here?"*

Ranked recommendations, from three sources, and the order is the ranking:

| Priority | Source | Example |
| --- | --- | --- |
| 1 | RED findings | Station 3 overlaps Column C4 |
| 2 | Draft field groups on equipment in use | The AK98's service clearance is not cited |
| 3 | Uncalibrated levels | 5F cannot be measured |
| 4 | Checklist categories with derived items | Electrical: three outstanding |
| 5 | Model-suggested considerations, **marked as such** | Bed route from the door to station 8 is 900 mm |

Priorities 1–4 need no model: they are the report's own contents, ranked. Priority 5 is where the
assistant adds something, and it is visually separated because it has a different epistemic
status — a considered suggestion, not a finding.

**A recommendation never says "compliant".** It says what to check. The verdict is the report's.

**§ G and § G-2 are different questions and deliberately separate features.** *"What should I worry
about?"* is a ranked list of concerns about the design; *"in what order do I install this?"* is a
sequence. Merging them would produce a list that is neither ranked by risk nor executable in order.

---

## G-2. Installation sequence and commissioning plan

> *"In what order does this get installed, and what has to be signed off at each stage?"*
>
> Owner decision: *"Add an Installation Planner Agent. Responsibilities: installation sequence,
> commissioning checklist, installation planning."*

`packages/ai-planner`. Deterministic, offline, **no model** — and worth being clear about why: an
installation order is a dependency graph over stages defined in `standards/sequences/dialysis.json`,
and a topological sort of a graph is not a language task. A model producing the sequence would give a
different order on a second run, which for a document a site team works from is disqualifying.

| Step | | Where |
| --- | --- | --- |
| 1 | Engineer opens **Installation plan** for a level | `apps/web` |
| 2 | Client assembles a `PlanRequest`: placements, utility origins, open findings, the sequence set ref | `apps/web` |
| 3 | Planner loads the stage set and its declared dependencies | `ai-planner` |
| 4 | Stages instantiated **only where the project has something for them** — no RO stage without RO equipment | `ai-planner` |
| 5 | Dependencies resolved; cycle → an error, never a guessed order | `ai-planner` |
| 6 | Each stage's commissioning items taken from the **report engine's existing checklist**, by id | `ai-planner` |
| 7 | Blockers collected: open RED findings, missing origins, prerequisites the project lacks | `ai-planner` |
| 8 | Plan shown, and available to the report as an ordered section | `apps/web` |

### Step 6 is the decision that keeps the plan honest

Sprint 5 already builds a bilingual checklist from `standards/checklists/dialysis.json` plus items
derived from data gaps, and that checklist is in the signed report. The planner **references those
items by id** rather than writing commissioning text of its own.

The alternative — a planner with its own checklist — produces two lists in one project that can
disagree, and the one an installer follows would be the one that is not in the signed document. One
source, two presentations: grouped by category in the report, grouped by stage in the plan.

### The plan states order, not dates

| | |
| --- | --- |
| Order and dependency | ✅ Derived from the standards data |
| Which placements each stage touches | ✅ By id, so the plan and the drawing agree |
| Sign-off items per stage | ✅ The report's own checklist items |
| Durations, dates, a Gantt chart | ❌ **Never** |

Durations depend on crew size, site access, lead times and a contract — none of which this platform
holds. A plan printing "2 days" for an electrical stage would be an invented number in a document a
site team plans around, which is the same failure as an uncited clearance (AD-19). `InstallationStage`
declares `durationDays?: never` so this is a contract rather than an omission to be re-argued.

### A plan for a layout with an open RED finding

It is produced, and it leads with the blocker. Refusing to plan would be unhelpful — an engineer
reasonably wants to see the sequence while resolving findings — but a plan that quietly sequenced past
a station overlapping a column would be a plan to build that station. The blockers are part of the
plan, at the top, in both languages, with the finding's reason code.

---

## H. Report summarisation

> *"Give me three sentences for the covering email."*

| | |
| --- | --- |
| Input | The report model, **minus every raster** |
| Output | A draft, in the assistant panel |
| Where it goes | Wherever the engineer copies it |
| Where it does **not** go | The report |

Restating from the architecture, because it is the decision most likely to be questioned:
**generated prose does not enter the signed document.** The report's own text is composed from
label keys and reason codes precisely so that every sentence in it is traceable; a paragraph a
model wrote would be the only untraceable text in the document, and it would sit under a
signature.

An engineer who wants that paragraph in an email is welcome to it. That is a different artefact
with a different standard.

---

## I. Engineering knowledge retrieval — the Knowledge Engine

> *"What does the manual say about drain height?"*
>
> Owner decision: *"Knowledge retrieval shall occur before any LLM reasoning. LLM shall never answer
> directly from memory."*

Revision 1 had this as the ninth feature in a list. Decision 1 makes it **stage ① of three other
features as well**, so it is the component with the most dependents in the sprint and the first one
that has to work.

| Step | |
| --- | --- |
| 1 | Documents are indexed ahead of time — manuals, standards, internal guidelines, rule sets |
| 2 | A query retrieves passages: keyword (BM25) and vector, results merged and ranked |
| 3 | Passages returned **with document, revision, section and page** — quoted, never paraphrased into the index |
| 4 | Nothing above the relevance threshold → **`empty: true`**, and that is the answer |
| 5 | The engineer reads the passage. The assistant does not paraphrase it into a figure. |

**Step 3 is the whole feature.** A retrieved passage with a citation is evidence an engineer can
act on and a report can quote. The same passage summarised into "the drain must be 40 mm" is an
uncited figure wearing the appearance of one — and this product's entire discipline is that a
figure without a document behind it is not a figure.

**Step 4 is what decision 1 buys.** `empty: true` ends the request: no model is called, and the
engineer is told the corpus does not cover the question. The failure this removes is the expensive
one — a fluent answer about a manual nobody indexed, indistinguishable on screen from one drawn from
the page.

**Step 2 stores quotations, not summaries.** An index of paraphrases is an index whose citation does
not say what the cited page says. It costs storage and it is the only version that can be trusted;
this is the report's manufacturer-citation rule applied one layer earlier.

**Retrieval is also the path out of A-1.** If the AK98 manual is indexed, the assistant can find
the clearance table and an engineer can transcribe it into the catalogue **with its citation**.
The AI does not write the catalogue: it helps a person find what to write, and a person writes it.
That is the correct division for the data the whole product is blocked on.

### What is not decided here

Which documents may be indexed, and where the index lives, is data residency (B-4) again — a
manufacturer manual is licensed material and a hospital's own reports are the project's data. The
engine's contract is indifferent to the answer: `KNOWLEDGE_CORPORA` names four corpora and any of them
can be absent, with `RetrievalResult.searched` reporting what was actually consulted so an answer never
implies coverage the deployment does not have.

---

## J. Failure, plainly

| What fails | What the engineer sees | What changes in the document |
| --- | --- | --- |
| No service configured | Language features hidden; solver, scoring and planner work | Nothing |
| Service unreachable | "The assistant is unavailable" | Nothing |
| Response fails validation | "The assistant could not answer that" | Nothing |
| **Nothing retrieved** | "Not in the indexed corpus" — no model call, and the engine facts remain on screen | Nothing |
| **A response cites a passage it was not given** | Rejected by validation before display | Nothing |
| A proposal makes findings worse | The before/after shows it; accept is still theirs | Nothing until accepted |
| Solver finds nothing legal | "No position in this room satisfies the rules", with the binding constraint | Nothing |
| **A criterion cannot be measured** | `unavailable` beside the score, naming what is missing — never a zero | Nothing |
| **No utility origins placed** | Three criteria `unavailable`; the panel prompts for the origins | Nothing |
| **A sequence set has a dependency cycle** | An error naming the stages in the cycle | Nothing |
| **A plan has an open RED blocker** | The plan, with the blocker first | Nothing |
| Contract version mismatch | Capability reported unavailable | Nothing |

Every row's last column is the same, and that is the property to hold onto: **an AI failure is
never a document failure.**

The five rows added in revision 2 share a shape worth naming: each is a case where the *tempting*
behaviour is to produce something. A missing passage invites a plausible paragraph, an unmeasurable
criterion invites a zero, a cyclic sequence invites a guessed order, a blocked plan invites silence.
Each of those would be more pleasant to use and would put an unfounded statement into an engineering
document. The refusals are the feature.
