# AI System Architecture

> **Approved. Implementation in progress.**
> Sprint 6 — AI Engineering Assistant.
> Product mission, owner decision: *"AI-assisted Dialysis Facility Engineering Platform."*
>
> **Revision 3** — the owner's approved engineering weights (B-5a) in § C-4, with two criteria the
> weight table introduced (installation feasibility, walking distance) defined, and § C-4a added for
> the one thing the table could not do literally: station count as a constraint rather than a
> zero-weight criterion. `UtilityOrigin` is renamed `ReferencePoint`, because two of the new criteria
> measure from a goods entrance and a nurse base.
>
> **Revision 2** folded in four owner decisions taken after the first review:
>
> | # | Decision | Where it lands |
> | --- | --- | --- |
> | 1 | A **Knowledge Engine**. Retrieval happens **before** any LLM reasoning; the model never answers from memory | § C-2, and AD-16 |
> | 2 | An **Installation Planner Agent** — sequence, commissioning checklist, planning | § C-3 |
> | 3 | A **weighted scoring engine** replacing station-count-only optimisation, over seven weighted criteria, configurable | § C-4, and AD-14 rewritten |
> | 4 | The solver maximises **total engineering score** | § C-4 |
>
> Two of these change earlier positions in this document rather than adding to them, and both are
> called out where they do.
>
> Related: [AI_SERVICE_API.md](AI_SERVICE_API.md) · [AI_WORKFLOW.md](AI_WORKFLOW.md) ·
> [AI_PROMPT_GUIDELINES.md](AI_PROMPT_GUIDELINES.md) ·
> [../roadmap/SPRINT_6_IMPLEMENTATION_PLAN.md](../roadmap/SPRINT_6_IMPLEMENTATION_PLAN.md)

---

## A. The constraint that shapes everything

> Owner decision: *"Do NOT implement LLM-specific code inside business logic. Introduce an AI
> Service layer that communicates only through stable interfaces."*

Taken literally and made structural, that is one rule:

**No package under `packages/` may import an AI client, a model name, a prompt, or a token
count.** The linter already forbids React, Konva, NestJS and Node built-ins there; the AI client
joins that list, so the boundary is enforced at build time rather than by memory.

Everything below follows from it.

### Why the constraint is right, not merely instructed

A dialysis installation review is a document somebody signs. Three consequences:

1. **A model cannot be an authority.** If an LLM decides whether 1,200 mm of clearance is
   satisfied, the answer is unreproducible and uncitable, and the rule engine's whole design —
   every threshold from a file, every finding naming its source — is bypassed by the newest
   component.
2. **A model cannot be a dependency of correctness.** `evaluate()` is pure and produces
   identical bytes twice. That property is what lets a server's verdict be compared against the
   browser's. An AI call inside it destroys the property permanently.
3. **A model must not be able to write to the document silently.** Any AI change to a layout has
   to arrive as a **proposal** an engineer accepts, expressed in the same commands a hand
   gesture produces — so it is undoable, reviewable and visible in the history.

So the AI's job is **decision support**, not decision making. It proposes, explains, retrieves
and summarises. The rule engine judges.

---

## B. Where the AI sits

```
┌────────────────────────────────────────────────────────────────────────────┐
│ apps/web                                                                   │
│  ┌──────────┐  ┌────────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Canvas   │  │ Assistant panel│  │ Proposal     │  │ Installation plan│ │
│  │          │  │                │  │ review UI    │  │ view             │ │
│  └──────────┘  └───────┬────────┘  └──────┬───────┘  └────────┬─────────┘ │
│                        │  AiClient (interface)                │           │
└────────────────────────┼──────────────────┼───────────────────┼───────────┘
                         │                  │                   │
           ┌─────────────▼──────────────────▼───────────────────▼──────────┐
           │ packages/ai-contract              (pure TypeScript)           │
           │  requests, responses, Zod schemas, AiClient, ScoringModel,    │
           │  InstallationPlan.  NO model, NO prompt, NO network.          │
           └───┬───────────────────┬──────────────────┬────────────────────┘
               │                   │                  │
   ┌───────────▼─────────┐ ┌───────▼────────┐ ┌───────▼──────────────────────┐
   │ packages/ai-local   │ │ packages/      │ │ apps/ai-service (Python)     │
   │ • layout solver     │ │ ai-planner     │ │ ┌──────────────────────────┐ │
   │ • weighted scoring  │ │ • sequence     │ │ │ 1. KNOWLEDGE ENGINE      │ │
   │ • candidate ranking │ │ • commissioning│ │ │    retrieve + cite       │ │
   │ NO LLM              │ │ NO LLM         │ │ └────────────┬─────────────┘ │
   └───────────┬─────────┘ └───────┬────────┘ │              │ passages      │
               │                   │          │ ┌────────────▼─────────────┐ │
               │                   │          │ │ 2. LLM reasoning          │ │
               │                   │          │ │    ONLY over retrieved    │ │
               │                   │          │ │    passages + engine facts│ │
               │                   │          │ └──────────────────────────┘ │
               │                   │          └──────────────────────────────┘
   ┌───────────▼───────────────────▼──────────────────────────────────────┐
   │ packages/rule-engine · object-library · document-model ·             │
   │ report-engine — unchanged, and unaware that an AI exists             │
   └──────────────────────────────────────────────────────────────────────┘
```

**Retrieval sits *above* reasoning in the service, not beside it.** That ordering is decision 1 and
it is the whole shape of § C-2: the LLM stage cannot be reached without passing through the
knowledge engine, so "answer from memory" is not a behaviour to discourage — it is a path that does
not exist.

### Three implementations behind one interface

This is the load-bearing decision of the sprint, and it is not the obvious one.

| | `ai-local` | `ai-planner` | `ai-service` |
| --- | --- | --- | --- |
| What it is | A layout solver and scoring engine | An installation sequencer | Knowledge engine + LLM |
| Runs | In the browser, offline | In the browser, offline | Over HTTP |
| Handles | Placement, layout, weighted scoring | Sequence, commissioning, planning | Retrieval, then language |
| Reproducible | **Yes** | **Yes** | No |
| Needed for a signed report | Yes | Yes | No |

**Layout optimisation is not a language problem.** Placing twelve stations in a room subject to
clearance and access constraints is a packing problem with a rule engine as its oracle. A solver
does it reproducibly, offline, in milliseconds, and an engineer can be told exactly why it chose
what it chose. An LLM doing the same work would produce a different layout each run, unable to
guarantee the constraints it was given, and the audit trail would be a transcript.

So the sprint's *first* deliverable is the solver, and the LLM is the part that talks about it.
Both sit behind `AiClient`, so the interface is what the editor knows and either half can be
absent:

| Feature | Needs the LLM? |
| --- | --- |
| AI-assisted equipment placement | No — solver |
| Layout optimisation, **weighted over the owner's seven criteria** | No — solver |
| Automatic room layout proposals | No — solver |
| Installation recommendation engine | No — rules + solver, ranked |
| **Installation sequence and commissioning plan** | No — planner |
| **Engineering knowledge retrieval** | **No** — the knowledge engine retrieves and cites; a model is not needed to *find* a passage |
| Rule explanation engine | **Partly** — the facts come from the rule set, the passages from the knowledge engine, the prose from the model |
| Natural-language engineering queries | Yes, after retrieval |
| Report summarisation | Yes, over supplied content |

**Six of nine features work with no model at all**, and retrieval moved into that column with
decision 1: a knowledge engine that returns cited passages is a search index, not a language model.
Only three features need the LLM, and each of them needs retrieval to have run first.

That matters for B-4 (data residency): the sprint's value does not depend on it being answered.

---

## C. New packages and applications

| Where | What | Depends on |
| --- | --- | --- |
| `packages/ai-contract` | Request/response types, Zod schemas, `AiClient`, `AiProposal`, `ScoringModel`, `InstallationPlan`. Pure. | `document-model`, `rule-engine`, `object-library` |
| `packages/ai-local` | The layout solver **and the weighted scoring engine**: candidate generation, constraint evaluation via `rule-engine`, criterion measurement, scoring. Pure. | `ai-contract`, `cad-engine`, `rule-engine` |
| `packages/ai-planner` | Installation sequence and commissioning plan. Dependency ordering, not language. Pure. | `ai-contract`, `report-engine`, `rule-engine` |
| `apps/ai-service` | Python FastAPI. **Knowledge engine first**, then prompt assembly and model calls. | HTTP only |
| `apps/web/src/features/assistant` | The panel, the proposal review UI, the plan view, the client wiring | `ai-contract`, `ai-local`, `ai-planner` |
| `standards/scoring/dialysis.json` | Criterion weights and normalisation. **Data**, versioned in git. | — |
| `standards/sequences/dialysis.json` | Installation stages and their dependencies. **Data**. | — |

**`ai-contract` has no AI in it.** That is the point of the name: it is the vocabulary in which
a request and a proposal are expressed, and it would be equally valid if the other side were a
person. Both implementations, the editor, and any future server read it.

**Nothing in `packages/` gains a dependency on `apps/ai-service`.** The HTTP client lives in
`apps/web`, because a network call is a host concern — the same rule that keeps `fetch` out of
the report engine and font bytes an argument.

---

## C-2. The Knowledge Engine

> Owner decision: *"Knowledge retrieval shall occur before any LLM reasoning. LLM shall never
> answer directly from memory."*

### It is a stage, not a service the model may skip

```
question ──► ① KNOWLEDGE ENGINE ──► passages + citations ──► ② LLM ──► answer
                    │                                                    │
                    │ nothing found                                      │
                    └──────────► "not in the indexed corpus" ────────────┘
                                 (the model is never invoked)
```

The ordering is enforced by **structure, not instruction**. In `apps/ai-service` the model client
is unreachable from a request handler: a handler calls the knowledge engine, and the LLM stage takes
retrieved passages as a **required, non-empty** argument. A request that retrieves nothing returns
"not in the indexed corpus" without a model call ever being made.

That is the difference between this and a prompt saying "only use the supplied context". A prompt is
a request; a required argument is a constraint. The first version of this document already made that
distinction about citations, and decision 1 extends it to the whole reasoning path.

### What is indexed

| Corpus | Contents | Why |
| --- | --- | --- |
| Manufacturer documentation | Installation manuals, datasheets, service bulletins | The authority this product defers to (AD-6) |
| Standards and codes | Whatever the reviewing organisation applies | The other half of a citation |
| `standards/` itself | Rule records, checklist templates, scoring weights | "Why does this rule exist?" is answerable from the rule |
| The project's own reports | Previously generated `ReportModel` JSON | "What did we conclude on the third floor?" |

Every passage carries **document, revision, section and a character range**. A retrieval result
without a locatable citation is discarded by the engine, not passed on with a caveat: an
uncitable passage cannot become a citation, and a citation is the only thing that makes a retrieved
figure usable.

### Retrieval is not a language model

Worth stating because "RAG" invites the assumption that the retriever is itself a model:

| | |
| --- | --- |
| Index | Lexical (BM25) **and** vector, results merged. Lexical alone misses paraphrase; vector alone misses an exact part number, and a part number is exactly what an engineer searches for. |
| Embeddings | A sentence-embedding model, not a chat model. It produces vectors and cannot produce a claim. |
| Ranking | Deterministic given the index. Same query, same passages. |
| Failure | Returns nothing. Never returns a guess. |

So `retrieve` is a capability that works **with no LLM configured at all** — which is why
"engineering knowledge retrieval" moved out of the LLM column in § B. An engineer can search the
indexed manuals and read cited passages with the language half switched off entirely.

### Why this is the most valuable half of the AI work

A-1 has blocked this product for five sprints: the AK98 manual has not been supplied, so every
clearance finding reads "no requirement to compare against".

The knowledge engine is the path out of it that does not require anybody to invent a figure. Index
the manual, retrieve the clearance table with its document, revision and section, and an engineer
transcribes it into the catalogue **with the citation**. The AI does not write the catalogue; it
helps a person find what to write, and a person writes it.

That is the correct division of labour for the data the whole product is waiting on, and it is the
reason to build retrieval before anything conversational.

---

## C-3. The Installation Planner Agent

> Owner decision: an Installation Planner Agent, responsible for installation sequence,
> commissioning checklist, and installation planning.

### Deterministic, and in `packages/`

Sequencing is a **dependency-ordering problem**, not a language problem: the water loop is pressure
tested before a machine is connected to it, electrical is energised before commissioning, and the
floor is finished before anything is anchored to it. Those are edges in a graph, and a topological
order over them is exact, reproducible and explicable.

So `packages/ai-planner` is pure TypeScript with no model in it, and the stage dependencies live in
`standards/sequences/dialysis.json` as data — for the same reason the thresholds and the checklist
categories do. A customer whose site sequences differently edits a file.

### It does not produce a second checklist

The report already has one (§ 6 of the report), built from `standards/checklists/` plus items
derived from findings and data gaps. A planner that generated its own would give an engineer two
lists that disagree, and the one in the signed report would be the one they were not looking at.

Instead:

| The report's checklist | The planner's plan |
| --- | --- |
| **What** must be checked | **When**, and in what order |
| Grouped by trade | Grouped by stage, with dependencies |
| Derived from findings and data gaps | Derived from the same items, **sequenced** |
| Goes in the signed document | A working document for the installation |

The planner **consumes** the report's checklist items and arranges them. One source, two views —
so an item cannot exist in the plan and not in the report.

### What a plan contains

| | |
| --- | --- |
| Stages, ordered | Site preparation → services rough-in → pressure test → equipment set → connection → commissioning → handover |
| Dependencies, explicit | Each stage names what must be complete before it starts |
| Per-stage checks | The report's checklist items, allocated to the stage that verifies them |
| Blockers | Items that cannot be scheduled at all — an uncited clearance, an uncalibrated level |
| **Not** durations or dates | Nobody has supplied labour rates or crew sizes. A plan with invented durations is a schedule somebody would resource against. |

That last row is a refusal, and it is the same one the rest of this codebase makes: an invented
figure that reaches a document is indistinguishable from a real one. Sequence is derivable from
dependencies; duration is not derivable from anything the project holds.

### Where the LLM may touch a plan

Only to **explain** it: "why is the pressure test before the equipment set?" — answered from the
dependency data and retrieved passages, with citations. It may not reorder a plan, add a stage, or
estimate a duration.

---

## C-3a. Duration and manpower — AD-19 as amended

> Owner decision, Sprint 6 § 3: the planner outputs **Required Manpower** and **Estimated
> Installation Duration**.
> Owner decision, Sprint 6 §§ 4–5: *"Never generate uncited engineering values. Unknown values
> remain 'Unknown'"*, and every recommendation states whether it is Verified, Draft, Planning or
> Calculated.

§ C-3 above said a plan carries no durations, and `InstallationStage` enforced it with
`durationDays?: never`. The owner's decision asks for both figures **and supplies the rule that
makes them safe**, so the refusal moves rather than lifting:

| | Before | Now |
| --- | --- | --- |
| A duration may be stated | Never | When a **sourced** `InstallationRate` supports it (B-7) |
| A duration may be **invented** | Never | **Never** |
| Nothing supplies a rate | The field could not exist | The field says `unknown`, naming the file that would answer it |

**B-7 settles the mechanics**, and they are `packages/ai-planner/src/effort.ts`:

```
InstallationRate { id, stage, hoursFixed, hoursPerStation, minimumPersons, recommendedPersons, source }

Duration = hoursFixed + (hoursPerStation × stationCount)
Manpower = minimumPersons, recommendedPersons
```

Every field of a rate is required and `source` is a citation, so **a partial rate is not a rate** —
there is no half-formula to evaluate, which is what closes the door on interpolation. Each figure
carries a `Calculation` with the owner's four disclosures: the formula, every input *with its
value*, the rate id and the citation. EV-6 makes the last two stand or fall together.

`standards/sequences/dialysis.json` ships `installationRates: []`, so every figure the product
prints today is `unknown` and the report states *"Planning rate data not available."* — verbatim,
because a paraphrase would be a different document from the one approved. That is the same answer
AD-19 gave, reached by a mechanism that produces a real one the moment somebody supplies a rate.

**Supplying one needs no code change**, and that is tested rather than asserted: a test takes the
shipped set, adds rates the way an editor of that file would, and the whole feature comes on.

**Totals refuse partial knowledge.** A duration summed over the stages that happened to have rates
is smaller than the truth, looks complete, and is the one somebody quotes; so a total with any
unknown part is itself `unknown`, and the per-stage rows show which. The same rule governs a
connection plan's total length.

---

## C-3b. The planner boundary — two interfaces, not one

> Owner decision, Sprint 6 § 7: *"Introduce AiPlanner API only as an abstraction layer. The
> deterministic planner is the default implementation. Future LLM implementations may summarize
> planner output but must never replace planning logic."*

```
  PlanInput ──► AiPlanner.plan() ──► InstallationPlan ──► PlanSummariser.summarise() ──► prose
              deterministic, offline                       optional, may be a model
```

`AiPlanner.plan` produces a plan. `PlanSummariser.summarise` **accepts** a finished plan and returns
text. A model can implement the second and cannot implement the first — not by policy, by signature.
One interface with a single `plan()` method would have made "an LLM planner" a legal implementation
and left *"must never replace planning logic"* as a comment.

Two further properties are held by types rather than by discipline:

| Owner requirement | How |
| --- | --- |
| § 1 — *"receives only validated layouts, never plan directly from raw user drawings"* | `PlanInput.evaluation` is a **required** field. A caller holding an unevaluated drawing cannot construct the argument |
| § 6 — *"must work completely offline"* | `AiPlanner.requiresNetwork` is the **literal type `false`**. An implementation needing a network could not satisfy the interface |

The offline claim is also tested where it is actually made: `tests/e2e/planning.spec.ts` runs the
whole acceptance path — Draw → Generate → Optimize → Approve → Plan → Export PDF — with every
outbound request aborted *and recorded*, and asserts nothing was requested. Aborting alone would not
be a test: a denied request to a CDN would very likely leave the application working, and the run
would pass while the product had acquired a dependency that fails on an air-gapped laptop.

---

## C-4. The weighted scoring engine

> Owner decision: replace the station-count objective with a **weighted scoring engine** over rule
> compliance, station count, RO piping length, drain routing, electrical routing, maintenance access
> and future expansion. The model shall be configurable, and the solver shall maximise **total
> engineering score**.

**This replaces § E of the first revision and resolves B-5.** The earlier position — optimise
station count, measure the rest, rank on nothing else — was a placeholder for exactly this decision.

### One correction, and it is important

**Rule compliance cannot be a weighted term.** A weighted sum lets a criterion be traded away, and
a layout that breaks a RED rule must not be purchasable with two extra stations and a shorter drain
run. So compliance enters in two different ways, and conflating them would be the single most
dangerous thing in this design:

| | How it enters |
| --- | --- |
| **A violation** (RED, or a YELLOW-severity rule breached) | A **filter**. The candidate is discarded, not scored. It is not a worse option; it is not an option. |
| **Compliance margin** — how much headroom above the requirement | A **scored criterion**. 1,400 mm where 1,200 mm is required is better than 1,205 mm, and that is a legitimate trade against pipe length. |

So "Rule compliance" in the owner's list is implemented as *margin*, and hard compliance is the gate
that runs before scoring. Stated plainly because the two readings look alike and only one is safe.

### The criteria, with the owner's approved weights

> Owner decision B-5a. **The weights are the owner's; they are not a developer default.**

| Criterion | Weight | Measured as | Direction | Needs |
| --- | --- | --- | --- | --- |
| Rule compliance margin | **40 %** | Minimum clearance headroom across every governed face, as a ratio of the requirement | More is better | `rule-engine` |
| Installation feasibility | **20 %** | Fraction of machines that can physically be delivered to their position and installed there — see below | More is better | An `access_entry` point |
| Maintenance access | **15 %** | Fraction of machines whose rear and side clearances are reachable from a circulation route without crossing another machine's envelope | More is better | Geometry |
| RO piping efficiency | **10 %** | Routed run from the loop origin to each machine's water port, summed | Less is better | An `ro_supply` point |
| Electrical routing | **5 %** | Routed run to the panel, summed | Less is better | An `electrical_panel` point |
| Future expansion | **5 %** | How many more machines the solver can add to the remaining floor **without moving any existing one** | More is better | The solver, recursively |
| Walking distance | **5 %** | Routed staff run from the nurse base to each machine, summed | Less is better | A `staff_base` point |
| Drain routing | **0 %** | Routed run to the drain, plus a penalty per fall-direction reversal | Less is better | A `drain` point |
| Station count | *constraint* | Placements of the requested category | — | — |

Weights sum to 1.00 over the seven the owner weighted. The last two rows are the reconciliation
between B-5a's weight table and the criterion list in decision 3, and both are recorded rather than
resolved silently:

**`drain_routing` is measured at weight 0.** It was named as a criterion and is absent from the
approved weight table. So it is measured, normalised and printed in every breakdown, contributing
nothing — visible, and weightable by editing one number in
[`standards/scoring/dialysis.json`](../../standards/scoring/dialysis.json).

**`station_count` is a constraint, not a criterion**, and this one is a judgement I had to make rather
than a transcription. See § C-4a.

### The two criteria B-5a introduced

Both were new in the weight table, so both need a definition that a solver can compute and an
engineer can check.

**Installation feasibility (20 %)** — *can this actually be installed?* Deterministic, and it is where
the scoring engine and the installation planner meet:

| Component | Measured as |
| --- | --- |
| Delivery path | For each machine, is there a route from the level's `access_entry` to its position clear enough for its **crated** footprint? A machine that cannot be carried to where it is drawn is not installed. |
| Working space | Is there room for an installer at the connection faces during installation, which is not the same envelope as service clearance in use? |
| Planner blockers | Does `ai-planner` report a blocker for the stage that installs it? |

Scored as the fraction of machines with all three satisfied. The delivery-path term is the reason
`access_entry` exists: a layout can satisfy every clearance rule and still require a machine to pass
through a 700 mm door.

**Walking distance (5 %)** — staff circulation from a nurse base to each station, routed rather than
straight-line, summed and normalised per station. This is the criterion B-5 originally floated as
"staff walking distance", and it is the one whose weight I would have guessed highest and the owner
set lowest — recorded because it is exactly the kind of assumption a developer default would have
baked in wrongly.

### C-4a. Why station count is a constraint rather than a weighted criterion

This is the one place the approved weight table cannot be implemented literally, and the reason is
arithmetic rather than preference.

**Every other criterion improves as machines are removed.** One machine in a large room has enormous
compliance margin, perfect maintenance access, the shortest possible pipe run, the most expansion
room and the shortest walk. So in a model that maximises a weighted total, station count at weight 0
is not neutral:

| Layout | compliance | feasibility | maintenance | RO | electrical | expansion | walking | **total** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 station | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | **1.00** |
| 12 stations | 0.62 | 0.90 | 0.83 | 0.31 | 0.44 | 0.20 | 0.55 | **0.65** |

A solver told to maximise that total empties the room. Which is not a subtle mis-ranking — it is the
opposite of the feature.

So station count enters as a **target the engineer sets** — "twelve stations", or "as many as fit" —
and the solver satisfies it; the weights then rank the arrangements that *meet* it. Concretely:

| | |
| --- | --- |
| `propose_layout` | The engineer's target count, or the maximum achievable, is the constraint. Candidates below it are not ranked low, they are **not candidates**. |
| `optimise_layout` | **May never emit `placement.delete`.** An optimisation that improves a score by removing a machine is not an optimisation of the design. |
| The breakdown | Station count is measured and printed with the criteria, marked *constraint*, so it is visible without being tradeable. |

**This is the same shape as the compliance filter, one level down**, and the owner's closing sentence
is what makes it the right shape: *"Rule Compliance always has the highest priority and may never be
outweighed by optimization metrics."* The mechanism that guarantees that for compliance — remove it
from the weighted sum entirely — is the mechanism that has to guarantee it for station count too,
because a 40 % weight is still a weight and 60 % of the model can outvote it. Compliance is a filter
before scoring; station count is a constraint on the candidate set. Neither is purchasable.

**What I need confirmed:** whether station count was intended to drop out of the weighting (which
this reading assumes and which I think is right — you do not optimise *how many machines you want*,
you state it), or whether **installation feasibility** was meant to subsume it. If the latter, the
definition above changes and the weight table does not.

### The gap this exposes: the document records no reference points

**Five** of the criteria measure a distance **to something the document does not record**. There is
no RO loop entry, no drain stack, no electrical panel, no goods entrance and no nurse base in
`MfdDocument`. B-5a widened this from three criteria to five: installation feasibility needs an
entrance and walking distance needs a staff base.

That cannot be estimated. A piping score computed from a guessed origin is a number that looks like
engineering and is not, and it would rank layouts by an assumption nobody made.

So Sprint 6 adds them, and it is a document change:

```ts
/**
 * A named point on a level that engines measure distances from.
 *
 * Model millimetres, placed by the engineer, undoable like every other edit.
 */
interface ReferencePoint {
  readonly id: string;
  readonly kind:
    | 'ro_supply'
    | 'ro_return'
    | 'drain'
    | 'electrical_panel'
    | 'data'
    /** Where equipment is delivered onto the level. Installation feasibility. */
    | 'access_entry'
    /** Nurse station or staff base. Walking distance. */
    | 'staff_base';
  readonly position: Vec2;
  /** e.g. "Panel DB-3F-2". Null when the engineer has not named it — nullable rather than "" so
   *  an unnamed point and one named with an empty string cannot look alike. */
  readonly label: string | null;
}
```

`Level.referencePoints: ReferencePoint[]`, `DOCUMENT_VERSION` 3 → **4**, with a migration adding an
empty array.

**Renamed from `UtilityOrigin` / `Level.utilityOrigins`**, which is what revision 2 of this document
specified. B-5a's two new criteria need a goods entrance and a nurse base, and neither is a utility:
a type called `UtilityOrigin` with `kind: 'staff_base'` would be a name that lies about half its
values. The rename costs nothing because none of this is implemented yet, and it is cheaper now than
in the migration that would inherit it.

And the consequence has to be stated rather than discovered: **a layout cannot be scored on routing,
feasibility or walking distance until the engineer has placed the points.** The scoring engine reports
those criteria as *unavailable*, not as zero — a zero would rank a layout as having no pipe run at
all, which is the best possible score for a measurement that was never taken (AD-18).

With B-5a's weights that has a consequence worth naming. Four weighted criteria need a reference
point — feasibility 20 %, RO 10 %, electrical 5 %, walking 5 % — so **40 % of the model is
unmeasurable on a level with no points placed**, and the total is renormalised over the remaining
60 %.

A renormalised total still reads 0…1, which means **two layouts scored with different criteria
available are not comparable even though their totals look alike**. So the breakdown always prints
what was unavailable beside the total, comparison is only ever offered within one scoring request,
and a level with no reference points is flagged as such rather than being given a number that quietly
answers a different question.

### Normalisation, without which the weights mean nothing

Criteria are in different units: a count, a length in millimetres, a fraction. A weighted sum over
raw values is arithmetic nonsense — 8 stations plus 45,000 mm of pipe is not a quantity.

So each criterion normalises to **0…1** against an explicit reference, and the reference is part of
the configuration rather than hidden in the code:

```json
{
  "id": "dialysis_default",
  "version": "1.0.0",
  "criteria": {
    "compliance_margin":        { "weight": 0.40, "direction": "maximise", "reference": { "marginRatioTarget": 1.5 } },
    "installation_feasibility": { "weight": 0.20, "direction": "maximise", "reference": { "fractionTarget": 1.0 } },
    "maintenance_access":       { "weight": 0.15, "direction": "maximise", "reference": { "fractionTarget": 1.0 } },
    "ro_piping_length":         { "weight": 0.10, "direction": "minimise", "reference": { "perStation": 8000 } },
    "electrical_routing":       { "weight": 0.05, "direction": "minimise", "reference": { "perStation": 10000 } },
    "future_expansion":         { "weight": 0.05, "direction": "maximise", "reference": { "additionalStations": 4 } },
    "walking_distance":         { "weight": 0.05, "direction": "minimise", "reference": { "perStation": 12000 } },
    "drain_routing":            { "weight": 0.00, "direction": "minimise", "reference": { "perStation": 6000 }, "measuredOnly": true }
  },
  "constraints": {
    "station_count": { "unit": "count" }
  }
}
```

**The weights are the owner's decision (B-5a), not a developer default** — which is a change from
revision 2, where they were mine and flagged as a guess. The file carries an `authority` block saying
so, because the next person to edit it should know they are changing a decision rather than tuning a
constant.

**The references are still mine**, and that distinction matters: a weight says how much a criterion
counts, a reference says what counts as a full score in that criterion's own unit. 8,000 mm of RO pipe
per station scoring 0 is a developer's estimate of what "bad" looks like, and it is as load-bearing as
the weight above it. Recorded as the residue of B-5a rather than treated as settled — a weighted sum
is only as meaningful as its normalisation, so these deserve an engineer's eye too.

`version` moves to **1.0.0** with this decision. A scoring model that has been approved is not a
0.x file, and every `ScoreBreakdown` names the id and version that produced it, so a score in a report
from today remains reproducible after the weights are next revised.

### Every proposal shows its score broken down

> Owner decision B-5a: *"The UI must always display a per-criterion score breakdown. Never display
> only a single total score."*

A total is not an explanation. A proposal carries the per-criterion measurement, its normalised
value, its weight and its contribution:

```
Total engineering score  0.68   (over 95 % of the model — 1 criterion unavailable)

  compliance margin        1.8× requirement    0.90 × 0.40 = 0.360
  installation feasibility 10 of 10 deliverable 1.00 × 0.20 = 0.200
  maintenance access       9 of 10 reachable   0.90 × 0.15 = 0.135
  RO piping                94 m (9.4 m/stn)    0.15 × 0.10 = 0.015   ← the weakest term
  electrical routing       unavailable — no electrical_panel point placed
  future expansion         2 more stations      0.50 × 0.05 = 0.025
  walking distance         86 m (8.6 m/stn)    0.28 × 0.05 = 0.014

  station count            10 in 96 m²          constraint — not scored
  drain routing            62 m, 1 reversal     0.48 × 0.00 = 0.000   (measured only)
```

Three properties this gives, none of which a single-objective design could:

1. **An engineer can disagree specifically.** "The pipe run matters more than that here" is a
   weight change, not an argument about the tool.
2. **A trade is visible.** A layout with one more station and 30 m more pipe shows exactly what it
   bought and what it cost.
3. **The shape of what was not measured is visible.** The header states the fraction of the model
   the total was computed over, so a renormalised score cannot be mistaken for a complete one.

**Never printing a bare total is now an owner requirement, and it is enforced structurally rather
than by convention**: `ScoreBreakdown` with a `total` and an empty `criteria` array is
schema-invalid, so a renderer cannot be written that has only the total to show. See
[AI_SERVICE_API.md § C](AI_SERVICE_API.md).

### What the solver maximises

Total weighted score, over candidates that have already passed **both** gates — the hard-compliance
filter and the station-count constraint. Ties break on compliance margin: if two layouts score the
same, the safer one wins. That is a policy choice rather than an implementation detail, and it is the
tie-break the owner's *"Rule Compliance always has the highest priority"* implies.

### Multiple scoring profiles — designed for, not built

> Owner note, B-5a: *"Future versions may define multiple scoring profiles."*

Nothing in Sprint 6 needs more than one profile, and nothing in Sprint 6 prevents a second. The
contract already carries the model **by value** in every request and names its `{ id, version }` in
every breakdown, so a profile is a file in `standards/scoring/` and a selection stored in project
settings — the same shape `reportRenderMode` already has.

What is deliberately **not** built now: a profile picker, per-project weight overrides, or a UI for
editing weights. Each of those is a way for a score in a signed report to have been produced by
weights nobody reviewed, and none is needed until a second profile exists. The extension point is the
contract; the machinery waits for the requirement.

---

## D. The proposal, and why the AI cannot write to the document

Every AI change to a layout is an `AiProposal`: a list of **commands** plus the evaluation of
what the document would look like if they were applied.

```ts
interface AiProposal {
  readonly id: string;
  readonly kind: 'placement' | 'layout' | 'adjustment';
  readonly rationale: readonly RationaleItem[];   // codes, not prose — see below
  readonly commands: readonly ProposedCommand[];  // the same commands a gesture produces
  readonly evaluation: ProposalEvaluation;        // rule-engine output, before and after
  readonly confidence: 'deterministic' | 'heuristic' | 'suggestion';
}
```

Four properties follow, and each of them is a defect avoided:

| Property | The defect it prevents |
| --- | --- |
| Commands, not a mutated document | An AI change that undo cannot reverse, and that the history does not show |
| Evaluation before **and** after | A proposal that improves one clearance and breaks two, presented as an improvement |
| `confidence` names the source | A heuristic guess reading exactly like a solver result |
| `rationale` is codes | Prose that says a rule was satisfied when the rule engine says otherwise |

**A proposal is never auto-applied.** The engineer reviews the before/after findings and accepts
or discards. The reason is not caution about AI in general: it is that accepting a layout is an
engineering decision with a signature attached to it, and the person signing has to have seen
it.

### Rationale is codes, like findings

The rule engine's reason codes exist because a finding must mean the same thing in Korean, in
English, and in a support conversation six months later. A rationale has the same requirement,
so it uses the same mechanism — extended with `AR-` codes for proposal reasoning:

```
AR-201
전면 정비 공간 확보를 위해 300 mm 이동
Moved 300 mm to satisfy front service clearance
```

An LLM may **not** invent a rationale code. It may render one into fluent prose when asked, and
that is a different operation with a different failure mode: bad prose is embarrassing, an
invented justification is a document that lies about why a machine is where it is.

---

## E. What the AI is allowed to assert, and what it is not

The single most important table in this document.

| Question | Answered by | May the LLM answer it? |
| --- | --- | --- |
| Does this layout satisfy the clearance rules? | `rule-engine` | **No** |
| What is the AK98's front clearance? | The catalogue, with its citation | **No** |
| Is this figure verified? | `fieldVerification` | **No** |
| What is the verdict? | `report-engine` | **No** |
| Where should this machine go? | `ai-local` solver, checked by `rule-engine` | **No** |
| Which layout is better, and by how much? | `ai-local` scoring engine, with the breakdown | **No** |
| In what order is this installed? | `ai-planner`, from the dependency data | **No** |
| Which manual section covers drain sizing? | **The knowledge engine.** A search index, not a model | **No** — it retrieves, it does not answer |
| *Why* does this rule exist? | The rule's description **plus retrieved passages** | Yes, over what was retrieved |
| What does this finding mean in practice? | Explanation over `rule-engine` output and retrieved passages | Yes, over what was retrieved |
| Why is the pressure test before the equipment set? | The planner's dependency data, plus passages | Yes, over what was retrieved |
| Summarise these forty findings | Summarisation over the report model | Yes, over supplied content |

The pattern, tightened by decision 1: the LLM may **explain, rephrase and summarise content it was
given**. It may not produce a fact, and it may not be reached at all until the knowledge engine has
supplied something to reason over.

Note what moved. "Which manual section covers drain sizing?" was previously in the model's column
with "yes, with the citation". It is now the knowledge engine's, and the model is not involved in
finding it — because finding a passage is retrieval, and a model asked to find one can produce a
section number that does not exist.

Enforcement is not a prompt instruction — a prompt is a request, not a constraint. It is
structural:

0. **The model cannot be invoked without retrieved content.** The LLM stage takes passages as a
   required non-empty argument, so "answering from memory" is not a discouraged behaviour but an
   unreachable code path (§ C-2).
1. **Every numeric claim in an AI response must carry the id of the finding, rule, catalogue
   field or retrieved passage it came from.** A response with an unsourced number fails schema
   validation and is discarded before the engineer sees it.
2. **The assistant panel renders sourced values from the source**, not from the model's text: the
   model produces a template with slots, and the client fills them from the engine output. A
   model that hallucinates "1,400 mm" cannot get that number onto the screen, because the number
   is not taken from its reply.
3. **Nothing the LLM returns reaches the report.** Report summarisation writes into the assistant
   panel, and an engineer copies what they choose into a field they own. The signed document
   does not contain unattributed generated prose.

Point 3 is the one to argue about, and I want it on the record before code exists: the owner's
scope lists "report summarisation", and the safe version of it is a summary an engineer reads and
edits, not a paragraph that appears in a PDF a hospital receives.

---

## F. Determinism, and what happens when the service is absent

| State | The application |
| --- | --- |
| No AI service configured | Works entirely. Solver, scoring and planner run locally; language features are hidden, not broken. |
| Service unreachable | Language features report unavailable. Nothing about the layout, the findings or the report changes. |
| Service returns nonsense | Schema validation rejects it. The panel says the assistant could not answer. |
| **Nothing indexed** | Retrieval returns nothing and the LLM is never called. The panel says the corpus holds no answer — which is true, and is not the same as "no". |
| **No reference points placed** | Routing criteria report **unavailable**, not zero. A zero would score an unmeasured pipe run as the best possible one. |
| **No scoring model configured** | The shipped default in `standards/scoring/` is used, and the proposal names which model produced the score. |

**The report never depends on the AI.** `buildReport` gains no parameter in Sprint 6. That is the
test of whether this architecture held: if the report engine has to change to accommodate the
assistant, the boundary leaked.

---

## G. Data residency — B-4, and why the split answers it early

[OPEN_QUESTIONS](../OPEN_QUESTIONS.md) B-4 asks whether project data may leave the hospital
network. It is still open, and the architecture above is deliberately arranged so that Sprint 6
does not wait for it:

| If the answer is | Then |
| --- | --- |
| Data may not leave | Ship `ai-local` and `ai-planner`. **Six of nine features work.** `apps/ai-service` — and with it the knowledge index — is deployed on-premises later, or not at all. |
| Data may leave | Both halves ship. Requests carry the minimum: see [AI_SERVICE_API.md](AI_SERVICE_API.md) § D. |
| Self-hosted model | `apps/ai-service` is unchanged; only its model configuration differs. |

**No request ever carries the plan image.** A floor plan is the most identifying artefact in the
document, it is megabytes, and no language feature needs it. That is a constraint in the contract
rather than a habit — see AI_SERVICE_API.md § D.

---

## H. What this architecture deliberately does not do

| | Why |
| --- | --- |
| An LLM inside the rule engine or the report engine | Owner decision, and the reasons in § A |
| Auto-applied layout changes | An engineering decision needs a person |
| Generated prose in the signed report | § E point 3 |
| Fine-tuning on customer projects | Wants a data agreement nobody has asked for |
| Agentic multi-step tool use over the document | A single proposal an engineer reviews is auditable; a sequence of self-directed edits is not. Revisit when the review UI has earned trust. |
| Voice or image input | Not in the owner's scope |
| **Durations or dates in an installation plan** | Nobody has supplied labour rates or crew sizes. Sequence is derivable from dependencies; duration is not derivable from anything the project holds, and an invented one is a schedule somebody would resource against. |
| **A model that reorders a plan or adds a stage** | The dependency graph is data. A model may explain the order; changing it is a data change with a diff. |
| **Scoring a routing criterion without a reference point** | Reported unavailable. See § C-4. |

---

## I. Architecture decisions this adds

| # | Decision |
| --- | --- |
| AD-11 | **No package under `packages/` may import an AI client, a model name or a prompt.** Enforced by the linter, like every other boundary. |
| AD-12 | **The AI proposes; the engines decide.** Every AI-originated change is a command list plus a rule-engine evaluation, accepted by a person. |
| AD-13 | **Every AI numeric claim carries the id of the engine output it came from.** Unsourced numbers fail validation and never render. |
| AD-14 | **Layout optimisation is deterministic, and maximises a weighted engineering score.** A solver with the rule engine as its oracle, over criteria whose weights are the owner's decision (B-5a) and are data in `standards/scoring/`. Hard compliance and station count are gates rather than weights. *(Revised: the first version optimised station count alone.)* |
| AD-15 | **The application works with no AI service.** Absence hides features; it never breaks the review or the report. |
| AD-16 | **Retrieval precedes reasoning.** The LLM stage takes retrieved passages as a required, non-empty argument; a request that retrieves nothing is answered "not in the indexed corpus" with no model call. The model never answers from memory. |
| AD-17 | **Hard compliance is a filter, never a weight.** A candidate breaching a rule is discarded, not scored lower. Only compliance *margin* is scored, so no arrangement of other criteria can purchase a violation. |
| AD-18 | **A measurement that was not taken is reported unavailable, never zero.** Routing criteria without a reference point, retrieval with nothing indexed, a duration with no labour data. |
| AD-19 | **Sequence is derived; duration is not invented.** The installation plan orders stages from a dependency graph in `standards/sequences/`. A duration or crew size is **calculated from a rate in that file, with the rate id and the machine count named as its inputs, or reported `unknown`** — never chosen. Amended in Sprint 6; see § C-3a. |
| AD-20 | **A planner value is a number, a status and a source.** `verified` / `draft` / `planning` / `calculated` / `unknown`, with seven invariants making an uncited figure unrepresentable — `evidence.ts`, EV-1…EV-7. |
| AD-21 | **A planning figure comes from a sourced `InstallationRate` or it is Unknown** (B-7). Every field of a rate is required, so there is no partial rate and no half-formula; a calculated figure carries its formula, its input values, the rate id and the citation. |
