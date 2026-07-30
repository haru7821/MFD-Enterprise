# AI System Architecture

> **Revised for review. Not implemented.**
> Sprint 6 — AI Engineering Assistant.
> Product mission, owner decision: *"AI-assisted Dialysis Facility Engineering Platform."*
>
> **Revision 2**, folding in four owner decisions taken after the first review:
>
> | # | Decision | Where it lands |
> | --- | --- | --- |
> | 1 | A **Knowledge Engine**. Retrieval happens **before** any LLM reasoning; the model never answers from memory | § C-2, and AD-16 |
> | 2 | An **Installation Planner Agent** — sequence, commissioning checklist, planning | § C-3 |
> | 3 | A **weighted scoring engine** replacing station-count-only optimisation, over seven criteria, configurable | § C-4, and AD-14 rewritten |
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
| Layout optimisation, **weighted over seven criteria** | No — solver |
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

### The seven criteria

| Criterion | Measured as | Direction | Needs |
| --- | --- | --- | --- |
| Rule compliance margin | Minimum clearance headroom across every governed face, normalised against the requirement | More is better | `rule-engine` |
| Station count | Placements of the requested category | More is better | — |
| RO piping length | Manhattan run from the loop origin to each machine's water port, summed | Less is better | **A utility origin** |
| Drain routing | Manhattan run to the drain origin, plus a penalty per fall-direction reversal | Less is better | **A utility origin** |
| Electrical routing | Manhattan run to the panel, summed | Less is better | **A utility origin** |
| Maintenance access | Fraction of machines whose rear and side clearances are reachable from a circulation route without crossing another machine's envelope | More is better | Geometry |
| Future expansion | How many more machines the solver can add to the remaining floor **without moving any existing one** | More is better | The solver, recursively |

### The gap this exposes: the document has no utility origins

Three of the seven criteria measure a distance **to something the document does not record**. There
is no RO loop entry point, no drain stack, no electrical panel in `MfdDocument`.

That cannot be estimated. A piping score computed from a guessed origin is a number that looks like
engineering and is not, and it would rank layouts by an assumption nobody made.

So Sprint 6 adds them, and it is a document change:

```ts
/** Where a service enters the level. Model millimetres, traced by the engineer. */
interface UtilityOrigin {
  readonly id: string;
  readonly kind: 'ro_supply' | 'ro_return' | 'drain' | 'electrical_panel' | 'data';
  readonly position: Vec2;
  /** e.g. "Panel DB-3F-2". Null when the engineer has not named it — nullable rather than "" so
   *  an unnamed origin and one named with an empty string cannot look alike. */
  readonly label: string | null;
}
```

`Level.utilityOrigins: UtilityOrigin[]`, `DOCUMENT_VERSION` 3 → **4**, with a migration adding an
empty array. And the consequence has to be stated rather than discovered: **a layout cannot be
scored on routing until the engineer has placed the origins.** The scoring engine reports those
criteria as *unavailable*, not as zero — a zero would rank a layout as having no pipe run at all,
which is the best possible score for a measurement that was never taken.

### Normalisation, without which the weights mean nothing

Criteria are in different units: a count, a length in millimetres, a fraction. A weighted sum over
raw values is arithmetic nonsense — 8 stations plus 45,000 mm of pipe is not a quantity.

So each criterion normalises to **0…1** against an explicit reference, and the reference is part of
the configuration rather than hidden in the code:

```json
{
  "id": "dialysis_default",
  "version": "0.1.0",
  "criteria": {
    "compliance_margin": { "weight": 0.30, "direction": "maximise", "reference": { "target": 1.5 } },
    "station_count":     { "weight": 0.25, "direction": "maximise", "reference": { "perRoomArea": 12.0 } },
    "ro_piping_length":  { "weight": 0.10, "direction": "minimise", "reference": { "perStation": 8000 } },
    "drain_routing":     { "weight": 0.10, "direction": "minimise", "reference": { "perStation": 6000 } },
    "electrical_routing":{ "weight": 0.05, "direction": "minimise", "reference": { "perStation": 10000 } },
    "maintenance_access":{ "weight": 0.15, "direction": "maximise", "reference": { "target": 1.0 } },
    "future_expansion":  { "weight": 0.05, "direction": "maximise", "reference": { "target": 4 } }
  }
}
```

**These weights are a starting point I chose, not an engineering judgement anybody has made.** They
are in `standards/scoring/` so that changing them is a data change, and they are the thing I most
want the owner to correct — see the open question at the end of this section.

### Every proposal shows its score broken down

A total is not an explanation. A proposal carries the per-criterion measurement, its normalised
value, its weight and its contribution:

```
Total engineering score  0.71
  compliance margin    1.8× requirement   0.90 × 0.30 = 0.270
  station count        10 in 96 m²        0.80 × 0.25 = 0.200
  RO piping            94 m (9.4 m/stn)   0.15 × 0.10 = 0.015   ← the weakest term
  drain routing        62 m, 1 reversal   0.48 × 0.10 = 0.048
  electrical           unavailable — no panel origin placed
  maintenance access   9 of 10 reachable  0.90 × 0.15 = 0.135
  future expansion     2 more stations    0.50 × 0.05 = 0.025
```

Two properties this gives, both of which the earlier single-objective design could not:

1. **An engineer can disagree specifically.** "The pipe run matters more than that here" is a
   weight change, not an argument about the tool.
2. **A trade is visible.** A layout with one more station and 30 m more pipe shows exactly what it
   bought and what it cost.

### What the solver now maximises

Total weighted score, over candidates that have already passed the hard-compliance filter. Ties
break on compliance margin — if two layouts score the same, the safer one wins, and that is a
policy choice rather than an implementation detail.

> **Owner decision needed:** the **default weights**. Mine are above and they are a guess with a
> defensible shape (compliance and station count dominate, routing is secondary, expansion is a
> tiebreaker) and no authority behind it. Whatever a TS engineer would actually trade is what
> belongs in that file. Until it is answered the solver works and its ranking reflects my guess —
> which is why every proposal shows the breakdown rather than only the total.

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
| **No utility origins placed** | Routing criteria report **unavailable**, not zero. A zero would score an unmeasured pipe run as the best possible one. |
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
| **Scoring a routing criterion without a utility origin** | Reported unavailable. See § C-4. |

---

## I. Architecture decisions this adds

| # | Decision |
| --- | --- |
| AD-11 | **No package under `packages/` may import an AI client, a model name or a prompt.** Enforced by the linter, like every other boundary. |
| AD-12 | **The AI proposes; the engines decide.** Every AI-originated change is a command list plus a rule-engine evaluation, accepted by a person. |
| AD-13 | **Every AI numeric claim carries the id of the engine output it came from.** Unsourced numbers fail validation and never render. |
| AD-14 | **Layout optimisation is deterministic, and maximises a weighted engineering score.** A solver with the rule engine as its oracle, over seven criteria whose weights are data in `standards/scoring/`. *(Revised: the first version optimised station count alone.)* |
| AD-15 | **The application works with no AI service.** Absence hides features; it never breaks the review or the report. |
| AD-16 | **Retrieval precedes reasoning.** The LLM stage takes retrieved passages as a required, non-empty argument; a request that retrieves nothing is answered "not in the indexed corpus" with no model call. The model never answers from memory. |
| AD-17 | **Hard compliance is a filter, never a weight.** A candidate breaching a rule is discarded, not scored lower. Only compliance *margin* is scored, so no arrangement of other criteria can purchase a violation. |
| AD-18 | **A measurement that was not taken is reported unavailable, never zero.** Routing criteria without a utility origin, retrieval with nothing indexed, a duration with no labour data. |
| AD-19 | **Sequence is derived; duration is not invented.** The installation plan orders stages from a dependency graph in `standards/sequences/` and carries no durations or dates. |
