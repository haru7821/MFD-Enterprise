# AI Service API

> **Revised for review. Not implemented.**
> The contract between the editor and the AI, in both directions.
> Companion to [AI_SYSTEM_ARCHITECTURE.md](AI_SYSTEM_ARCHITECTURE.md).
>
> **Revision 2** adds the knowledge engine as a *stage* rather than a peer capability, the
> installation planner, and the weighted scoring model. `LayoutObjective` is gone — replaced by
> `ScoringModel` and `ScoreBreakdown`.

---

## A. One interface, three implementations

```ts
// packages/ai-contract/src/client.ts — pure TypeScript, no AI in it.

export interface AiClient {
  /** Which capabilities this implementation actually has. */
  readonly capabilities: readonly AiCapability[];

  // Deterministic. `ai-local` and `ai-planner`; no model, no network.
  propose(request: ProposalRequest): Promise<AiProposal[]>;
  score(request: ScoreRequest): Promise<ScoreBreakdown>;
  plan(request: PlanRequest): Promise<InstallationPlan>;

  /**
   * The knowledge engine. **A stage, not a convenience.**
   *
   * Every language method below is defined as retrieval followed by reasoning, and the service
   * enforces that internally: `explain`, `ask` and `summarise` call the engine first and pass the
   * passages to the model as a required argument. `retrieve` is exposed separately because it is
   * useful on its own — an engineer searching the indexed manuals needs no model at all.
   */
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>;

  // Language. Each of these retrieves first; none can be answered from memory (AD-16).
  explain(request: ExplainRequest): Promise<AiExplanation>;
  ask(request: QueryRequest): Promise<AiAnswer>;
  summarise(request: SummaryRequest): Promise<AiSummary>;
}

export const AI_CAPABILITIES = [
  // ai-local
  'propose_placement',
  'propose_layout',
  'optimise_layout',
  'score_layout',
  'recommend_installation',
  // ai-planner
  'plan_installation',
  // the knowledge engine — no LLM required
  'retrieve_knowledge',
  // the LLM, each retrieval-first
  'explain_rule',
  'explain_finding',
  'explain_plan',
  'answer_query',
  'summarise_report',
] as const;
```

**`retrieve_knowledge` sits in the middle group deliberately.** It is available whenever a corpus is
indexed, whether or not a language model is configured — because retrieval is a search index and
returning a cited passage needs no reasoning.

**`capabilities` is not decoration.** `ai-local` reports the five it can do offline, `ai-planner`
reports `plan_installation`, `ai-service` reports `retrieve_knowledge` and the language ones — and
only those it is configured for: a service with an index but no model key reports retrieval alone,
which is a supported deployment rather than a broken one. A composite client that delegates per
capability is how the three are used together, and it is why the editor asks *what can you do*
rather than *which one are you*.

Every method returning a rejected promise or a schema-invalid payload is treated the same way: the
capability is unavailable for this request, the panel says so, and **nothing about the document,
the findings or the report changes**.

---

## B. Requests — what the AI is given

### The rule that shapes every request

**A request carries the minimum that answers it, never the document.** Three reasons, in the order
they matter:

1. A plan image is the most identifying artefact in a project, and no language feature needs it.
2. `MfdDocument` is megabytes with a plan embedded. A request that carried it would be slow and
   would put a hospital's floor plan on a wire for no benefit.
3. Data residency (B-4) is unanswered. A contract that structurally cannot send the drawing is a
   contract that stays valid whichever way that question is decided.

```ts
/** Common to every request. Never the document, never the plan image. */
export interface AiRequestContext {
  /** Project id and level id, for correlating a proposal with what it was made against. */
  readonly projectId: string;
  readonly levelId: string;
  /** The contracts in play, so a stale service can refuse rather than guess. */
  readonly documentVersion: number;
  readonly evaluationResultVersion: number;
  readonly ruleSetRef: { readonly id: string; readonly version: string };
  /** Korean, English, or both — the assistant follows the report's convention. */
  readonly language: 'ko' | 'en' | 'both';
}
```

### `ProposalRequest` — placement, layout, optimisation

```ts
export interface ProposalRequest {
  readonly context: AiRequestContext;
  readonly intent: 'place_one' | 'fill_room' | 'optimise' | 'resolve_finding';
  /** The room to work in, as model-millimetre geometry. No pixels, no image. */
  readonly room: { readonly vertices: readonly Vec2[]; readonly name: string };
  readonly obstructions: readonly { readonly vertices: readonly Vec2[]; readonly kind: string }[];
  /** What is already placed, and what to place. Catalogue *ids*, never copied dimensions. */
  readonly existing: readonly PlacementSummary[];
  readonly equipmentObjectId: string;
  readonly quantity: number | null;
  /** For `resolve_finding`: which finding to try to clear. */
  readonly findingRuleId: string | null;
  /**
   * Where the services enter this level, in model millimetres.
   *
   * Required by three of the seven scoring criteria, and **empty is a legitimate value**: the
   * routing criteria then report `unavailable` rather than zero. A zero would score an unmeasured
   * pipe run as the best possible one (AD-18).
   */
  readonly utilityOrigins: readonly UtilityOriginSummary[];
  readonly scoring: ScoringModel;
}

/**
 * The weighted scoring model — owner decision, replacing station-count-only optimisation.
 *
 * Passed in rather than held by the solver, so the weights are a project-and-organisation choice
 * loaded from `standards/scoring/` and a proposal can name which model produced its score.
 */
export interface ScoringModel {
  readonly id: string;
  readonly version: string;
  readonly criteria: Readonly<Record<ScoringCriterion, CriterionConfig>>;
}

export const SCORING_CRITERIA = [
  'compliance_margin',
  'station_count',
  'ro_piping_length',
  'drain_routing',
  'electrical_routing',
  'maintenance_access',
  'future_expansion',
] as const;

export interface CriterionConfig {
  /** 0…1. The set need not sum to 1 — contributions are normalised by the total. */
  readonly weight: number;
  readonly direction: 'maximise' | 'minimise';
  /**
   * What counts as a full score, in the criterion's own unit.
   *
   * Without this the weights are meaningless: a weighted sum over a count and a length in
   * millimetres is not a quantity. Every criterion normalises to 0…1 against an explicit
   * reference, and the reference is configuration rather than a constant in the solver.
   */
  readonly reference: Readonly<Record<string, number>>;
}
```

**There is no `LayoutObjective` any more, and no `primary` criterion.** The first revision had one
because B-5 was open; the owner's decision closes it, and a single primary would now be a way to
reintroduce the thing it replaced.

**Hard compliance is not in `SCORING_CRITERIA`.** `compliance_margin` is headroom above a
requirement and is scored; a *violation* is a filter applied before scoring, so no weighting can
purchase one (AD-17). The two readings of "rule compliance" look alike and only one is safe.

`existing` carries a *summary* — id, transform, catalogue id — not equipment records. The solver
resolves dimensions from the catalogue itself, so a proposal cannot rest on a stale copy of a
footprint. That is the same rule that makes a `Placement` reference a catalogue entry rather than
embed one.

### `UtilityOriginSummary` — the geometry three criteria need

```ts
/**
 * Where a service enters the level. New in Sprint 6; requires `DOCUMENT_VERSION` 4.
 *
 * RO piping length, drain routing and electrical routing are distances **from somewhere**, and the
 * document has no somewhere today. So the sprint adds `Level.utilityOrigins`, and this is its
 * request-side projection.
 */
export interface UtilityOriginSummary {
  readonly id: string;
  readonly kind: 'ro_supply' | 'ro_return' | 'drain' | 'electrical_panel' | 'data';
  readonly position: Vec2;
}
```

**A missing origin is `unavailable`, never a distance of zero** (AD-18). Zero is the *best* possible
score for a criterion whose direction is `minimise`, so defaulting to it would reward an unplaced
service by ranking the layout that ignores it highest. `ScoreBreakdown` carries the distinction, and
a proposal produced without origins says so on its face.

### `ScoreRequest` — score a layout that already exists

```ts
/**
 * Scoring, separated from proposing.
 *
 * `propose` scores internally to rank candidates. This exists because an engineer's *own* layout
 * deserves the same number: without it the score is only ever attached to the machine's suggestion,
 * which makes it a sales figure rather than a measurement.
 */
export interface ScoreRequest {
  readonly context: AiRequestContext;
  readonly room: { readonly vertices: readonly Vec2[]; readonly name: string };
  readonly obstructions: readonly { readonly vertices: readonly Vec2[]; readonly kind: string }[];
  readonly placements: readonly PlacementSummary[];
  readonly utilityOrigins: readonly UtilityOriginSummary[];
  readonly scoring: ScoringModel;
}
```

### `PlanRequest` — installation sequence and commissioning

```ts
export interface PlanRequest {
  readonly context: AiRequestContext;
  /** What is being installed. Catalogue ids and transforms, as everywhere else. */
  readonly placements: readonly PlacementSummary[];
  readonly utilityOrigins: readonly UtilityOriginSummary[];
  /** The stage set to sequence against — `standards/sequences/dialysis.json`. */
  readonly sequenceSetRef: { readonly id: string; readonly version: string };
  /**
   * Open findings, so a plan can refuse to sequence past an unresolved one.
   *
   * A commissioning plan for a layout with a RED finding in it is a plan to commission something
   * that should not be built, and silence there would be the report engine's `Inconclusive`
   * problem in a new place.
   */
  readonly findings: readonly FindingFacts[];
}
```

**`PlanRequest` carries no dates and asks for none.** Durations and calendars are a project-management
concern the platform has no data for; a plan states order and dependency (AD-19).

### `ExplainRequest` — a rule or a finding

```ts
export interface ExplainRequest {
  readonly context: AiRequestContext;
  readonly subject:
    | { readonly kind: 'rule'; readonly ruleId: string }
    | { readonly kind: 'finding'; readonly finding: FindingFacts };
  readonly depth: 'brief' | 'full';
}

/**
 * The finding, as facts.
 *
 * Not the rendered sentence: the service is given the code, the parameters and the citation, and
 * asked to explain *what that means for an installation*. Handing it prose and asking it to
 * elaborate is how a model ends up restating a number it did not check.
 */
export interface FindingFacts {
  readonly reasonCode: string;
  readonly reasonParams: Readonly<Record<string, string | number | { ko: string; en: string }>>;
  readonly severity: 'RED' | 'YELLOW' | 'GREEN';
  readonly ruleId: string;
  readonly ruleName: { readonly ko: string; readonly en: string };
  readonly appliedThreshold: number | null;
  readonly measured: number | null;
  readonly unit: string;
  readonly thresholdOrigin: 'rule' | 'equipment' | 'none';
  readonly source: {
    readonly document: string | null;
    readonly revision: string | null;
    readonly section: string | null;
  };
  readonly verification: 'verified' | 'draft';
}
```

### `QueryRequest`, `RetrievalRequest`, `SummaryRequest`

```ts
export interface QueryRequest {
  readonly context: AiRequestContext;
  readonly question: string;
  /** Facts the editor is willing to expose for this question. Explicit, never "the document". */
  readonly grounding: GroundingBundle;
}

/**
 * What the assistant is allowed to know for one question.
 *
 * Assembled by the editor per request, so exposure is a decision made at a call site rather than
 * a property of being connected. A question about clearances does not need the customer's name.
 */
export interface GroundingBundle {
  readonly findings: readonly FindingFacts[] | null;
  readonly rules: readonly RuleFacts[] | null;
  readonly equipment: readonly EquipmentFacts[] | null;
  readonly levelSummary: LevelFacts | null;
  /** Always absent. Declared so its absence is a contract rather than an omission. */
  readonly planImage?: never;
}

/**
 * The knowledge engine's own request.
 *
 * Issued by the editor when an engineer searches the manuals, and issued *internally* by the
 * service as stage ① of every language method. One request type for both, so the passages a model
 * reasoned over are the same passages a person could have read.
 */
export interface RetrievalRequest {
  readonly context: AiRequestContext;
  readonly query: string;
  /** Which indexed corpora to search. Empty means all of them. */
  readonly corpora: readonly KnowledgeCorpus[];
  /** How many passages to return. The service caps it; a prompt cannot ask for the whole manual. */
  readonly limit: number;
  /**
   * Restrict to documents the project actually cites.
   *
   * A manual for a machine that is not in this project is not evidence about this project, and an
   * explanation drawing on one would cite a document the reader cannot find in the report.
   */
  readonly restrictToReferenced: boolean;
}

export const KNOWLEDGE_CORPORA = [
  'manufacturer_manual',
  'rule_set',
  'standard',
  'internal_guideline',
] as const;

export interface SummaryRequest {
  readonly context: AiRequestContext;
  /** The report model, minus every raster. Enforced by the type, not by remembering. */
  readonly report: ReportFactsWithoutRaster;
  readonly audience: 'engineer' | 'customer';
  readonly maxWords: number;
}
```

`planImage?: never` is a deliberate use of the type system as documentation: the field cannot be
set, and a reviewer reading the interface sees *why* rather than noticing it is missing.

**`RetrievalRequest` has no `grounding`, and `QueryRequest` keeps its.** They answer different
questions: retrieval searches an indexed corpus of *published* documents, grounding exposes facts
about *this project*. An answer needs both — the passage that states a requirement, and the measured
value it is being compared against — and conflating them would either put project data in a search
index or make a citation unresolvable.

---

## C. Responses — what the AI may return

### `AiProposal`

```ts
export interface AiProposal {
  readonly id: string;
  readonly kind: 'placement' | 'layout' | 'adjustment';
  readonly source: 'solver' | 'model';
  readonly confidence: 'deterministic' | 'heuristic' | 'suggestion';
  readonly rationale: readonly RationaleItem[];
  readonly commands: readonly ProposedCommand[];
  readonly evaluation: ProposalEvaluation;
}

export interface RationaleItem {
  /** `AR-nnn`. The AI may not invent one — see AI_SYSTEM_ARCHITECTURE § D. */
  readonly code: string;
  readonly params: Readonly<Record<string, string | number>>;
  /** The finding or rule this reasoning refers to, or null for a general statement. */
  readonly refersTo: string | null;
}

/**
 * A command the editor already knows how to apply.
 *
 * Named by `CommandType` from `@mfd/document-model` — the same vocabulary a mouse gesture uses.
 * So an accepted proposal is undoable, appears in the history with a label, and cannot express
 * anything a hand could not.
 */
export interface ProposedCommand {
  readonly type: 'placement.create' | 'placement.move' | 'placement.rotate' | 'placement.delete';
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ProposalEvaluation {
  readonly before: { readonly RED: number; readonly YELLOW: number; readonly GREEN: number };
  readonly after: { readonly RED: number; readonly YELLOW: number; readonly GREEN: number };
  /** Findings the proposal clears, and findings it introduces. Both, always. */
  readonly resolves: readonly string[];
  readonly introduces: readonly string[];
  /** Why this candidate won. Never a bare total — see `ScoreBreakdown`. */
  readonly score: ScoreBreakdown;
}
```

**`introduces` is not optional and not omitted when empty.** A proposal that lists what it fixes
and not what it breaks is the single most misleading thing this feature could produce, and an
absent field and an empty one must not look the same.

**`evaluation` is computed by the editor, not by the service.** The client applies the proposed
commands to a copy of the document, runs `evaluate()`, and fills this in before showing anything.
A service-supplied evaluation would be a claim about the rule engine made by something that is not
the rule engine.

### `ScoreBreakdown` — the total is the least interesting field

```ts
export interface ScoreBreakdown {
  readonly scoringModel: { readonly id: string; readonly version: string };
  /** 0…1, the weighted sum over criteria that could be measured. */
  readonly total: number;
  readonly criteria: readonly CriterionScore[];
  /**
   * Criteria that could not be measured, and why.
   *
   * Non-empty is normal, not an error. A total computed over five of seven criteria is a total the
   * reader must be able to see the shape of, so it is reported alongside rather than folded in.
   */
  readonly unavailable: readonly UnavailableCriterion[];
}

export interface CriterionScore {
  readonly criterion: ScoringCriterion;
  /** The measurement, in the criterion's own unit — 12 stations, 8,400 mm of pipe. */
  readonly measured: number;
  readonly unit: string;
  /** 0…1 after normalising `measured` against `CriterionConfig.reference`. */
  readonly normalised: number;
  readonly weight: number;
  /** `normalised × weight ÷ Σweights`. Stated so the arithmetic is checkable. */
  readonly contribution: number;
}

export interface UnavailableCriterion {
  readonly criterion: ScoringCriterion;
  /** `RC`-style and language-independent, so the panel and the report say the same thing. */
  readonly reasonCode: string;
}
```

**A `ScoreBreakdown` with a `total` and no `criteria` is schema-invalid.** This is the same
enforcement as the report's Inconclusive rule, applied to optimisation: a single number ranking two
layouts is unarguable-with, and the criteria are where an engineer disagrees usefully — *"you scored
maintenance access above expansion, and for this ward that is backwards."* The breakdown is also the
only way the default weights can be reviewed at all, and they are currently a guess awaiting an owner
decision.

**Renormalising by the weights that were measurable** — `÷ Σweights` over available criteria — is a
choice with a cost worth naming: two layouts scored with different criteria available are not
comparable, even though both totals read 0…1. The client compares only within one `ScoreRequest`, and
the report prints `unavailable` beside the total rather than a bare figure.

### `InstallationPlan` — order and dependency, no calendar

```ts
export interface InstallationPlan {
  readonly sequenceSet: { readonly id: string; readonly version: string };
  readonly stages: readonly InstallationStage[];
  /**
   * Why the plan is not complete, if it is not: an open RED finding, a missing utility origin, a
   * stage whose prerequisite is not in this project.
   */
  readonly blockers: readonly PlanBlocker[];
}

export interface InstallationStage {
  readonly id: string;
  readonly order: number;
  readonly title: { readonly ko: string; readonly en: string };
  /** Stage ids that must complete first. Derived from the standards data, never invented. */
  readonly dependsOn: readonly string[];
  /** Placement ids this stage acts on, so the plan and the drawing agree. */
  readonly placementIds: readonly string[];
  /** Commissioning items, in the report engine's own checklist vocabulary. */
  readonly checklistItemIds: readonly string[];
  /** Declared and always absent. Duration is not ours to state — see AD-19. */
  readonly durationDays?: never;
}
```

**The plan reuses the report engine's checklist items rather than producing prose.** Sprint 5 already
built a bilingual checklist from `standards/checklists/dialysis.json` plus derived data-gap items; a
planner writing its own commissioning text would be a second checklist that can disagree with the
one in the signed report.

`durationDays?: never` is the same technique as `planImage?: never`: the omission is a contract a
reviewer can see, not something to be re-argued when somebody wants a Gantt chart.

### `AiExplanation`, `AiAnswer`, `RetrievalResult`, `AiSummary`

```ts
export interface AiExplanation {
  readonly subject: string;
  /** Both languages, like everything the report prints. */
  readonly text: { readonly ko: string; readonly en: string };
  /** Every factual claim, tied to what produced it. Empty is invalid — see § E. */
  readonly citations: readonly Citation[];
}

export interface Citation {
  readonly kind: 'rule' | 'finding' | 'catalogue_field' | 'document';
  /** A rule id, a reason code, `vantive_ak98.serviceClearance`, or a manual reference. */
  readonly ref: string;
  /** Where in the text the claim sits, so the interface can mark it. */
  readonly span: { readonly start: number; readonly end: number } | null;
}

export interface AiAnswer {
  readonly text: { readonly ko: string; readonly en: string };
  readonly citations: readonly Citation[];
  /**
   * True when the question could not be answered from the grounding it was given.
   *
   * Required, and it is the field that decides whether this feature is trustworthy. A model
   * that answers everything is a model that invents; the interface makes "I was not given
   * enough to answer that" a first-class response rather than a failure.
   */
  readonly insufficientGrounding: boolean;
  /**
   * The passages stage ① returned. **Required, and empty means the model was never called.**
   *
   * Carried on the answer rather than kept server-side so the editor can show *what was read* next
   * to what was written, and so the retrieval-first rule is checkable by the client instead of
   * being a property the service asserts about itself (AD-16).
   */
  readonly retrieved: readonly RetrievedPassage[];
}

export interface RetrievalResult {
  readonly query: string;
  readonly passages: readonly RetrievedPassage[];
  /**
   * True when the corpus holds nothing relevant.
   *
   * The honest outcome, and the one that ends the request: no passages means no model call and no
   * answer, only *"not in the indexed corpus"*. A model asked to fill that gap from memory is the
   * exact failure decision 1 forbids.
   */
  readonly empty: boolean;
  /** Corpora actually searched, so an answer cannot imply coverage the index does not have. */
  readonly searched: readonly KnowledgeCorpus[];
}

export interface RetrievedPassage {
  readonly id: string;
  readonly corpus: KnowledgeCorpus;
  /** The text as indexed. Quoted, never paraphrased into the index. */
  readonly text: string;
  /** Enough to find it on paper: document, revision, section, page. */
  readonly source: {
    readonly document: string;
    readonly revision: string | null;
    readonly section: string | null;
    readonly page: number | null;
  };
  /** Retrieval score, for ranking and for a threshold below which nothing is returned. */
  readonly relevance: number;
}

export interface AiSummary {
  readonly text: { readonly ko: string; readonly en: string };
  readonly citations: readonly Citation[];
  /**
   * Report sections the summary drew on.
   *
   * A summary that silently skipped the validation section is the one failure mode that matters
   * here, so coverage is stated rather than assumed.
   */
  readonly coveredSections: readonly string[];
}
```

**Every passage quotes rather than paraphrases.** An index storing a summarised requirement is an
index whose citation does not say what the cited page says — the report's manufacturer-citation rule,
applied one layer earlier.

---

## D. Transport

| | |
| --- | --- |
| Protocol | HTTP, JSON, `POST /v1/{retrieve,explain,ask,summarise}` |
| Not over HTTP | `propose`, `score`, `plan` — `ai-local` and `ai-planner` run in the browser, so these are function calls. Listed here because their absence from the endpoint list is the architecture, not an omission. |
| Versioning | `/v1` in the path; `aiContractVersion` in every request and response |
| Timeout | 20 s, client-side. A slower answer is a failed answer — an engineer will have moved on. |
| Streaming | Not in Sprint 6. It complicates schema validation, and validation is what keeps unsourced claims off the screen. Revisit for long explanations. |
| Auth | Bearer token from configuration. No credentials in the document, ever. |
| Retries | One, on a network error only. Never on a 4xx: a rejected request is a contract problem, and repeating it produces the same rejection. |

### Version mismatch is refused, not tolerated

A service built against `EVALUATION_RESULT_VERSION 2` receiving version 3 facts **must refuse**:

```json
{ "error": "contract_mismatch", "expected": 2, "received": 3 }
```

The alternative — reading the fields it recognises and ignoring the rest — is how a service ends
up explaining a finding using a field that changed meaning. The editor treats a mismatch as an
unavailable capability and says so.

---

## E. Validation, and the rule that makes this safe

Every response is validated against a Zod schema in `ai-contract` **before the editor looks at
it**. Four checks are not stylistic:

1. **Retrieval preceded reasoning.** A language response whose `retrieved` array is empty is
   rejected, however well-formed its prose. This is decision 1 made checkable *by the client*: the
   service enforces the ordering internally, and the editor does not have to take its word for it.
   An answer with no passage behind it is an answer from memory, and AD-16 says there is no such
   response.
2. **Bilingual completeness.** `text.ko` and `text.en` both non-empty, or the response is
   rejected. The same rule the report labels follow.
3. **Every number is cited.** A response whose text contains a digit sequence with no `Citation`
   covering it is rejected. This is the mechanism behind AD-13 — a model cannot get a hallucinated
   figure onto the screen by writing it in a sentence.
4. **Every citation resolves.** A `ref` must name a rule, finding or catalogue field the request
   supplied, **or a passage in this response's own `retrieved` array**. A citation to a document
   that was not retrieved is rejected even when the document exists: a model recalling a real
   section number it did not read is precisely the plausible-wrong case retrieval was introduced to
   remove.

Check 3 has a false-positive cost — a model writing "one of the four sides" gets rejected for the
digit — and I would rather pay it. The failure it prevents is a number in a document a hospital
acts on; the failure it causes is an assistant that occasionally says it could not answer.

Check 1 has a cost too, and it is the more interesting one: a *general* question with no relevant
passage in the corpus now gets "not in the indexed corpus" rather than a helpful-sounding paragraph.
That is the trade the owner chose, and it is right for this product — an engineering assistant whose
answers are all traceable is more useful than one that is occasionally more fluent.

**Sourced values are rendered from the source, not from the text.** The model returns a template
with slots (`{finding.measured}`); the client substitutes from the engine output. That is what
makes point 3 an enforcement rather than a hope: even a response that passes validation cannot
display a figure the model chose.

### Deterministic responses are validated too, differently

`ScoreBreakdown` and `InstallationPlan` come from pure TypeScript, so hallucination is not the
risk — arithmetic drift and silent gaps are:

| Check | Rejects |
| --- | --- |
| `total` equals the sum of `contribution` | A breakdown whose parts do not make its whole |
| `criteria` ∪ `unavailable` covers every `SCORING_CRITERIA` member | A criterion quietly dropped instead of reported unmeasurable |
| No `CriterionScore` for a criterion listed `unavailable` | A measurement and an admission of no measurement, at once |
| Every `dependsOn` names a stage in `stages` | A sequence with a dangling prerequisite |
| `stages` is acyclic and `order` is a topological order of it | A plan that cannot be executed in the order it prints |

---

## F. What the service never receives

| | Why |
| --- | --- |
| The plan image | Most identifying artefact in the project; no feature needs it; megabytes |
| The whole `MfdDocument` | A request carries what answers it. `GroundingBundle` is assembled per call. |
| Customer contact details | Not needed to answer an engineering question |
| Credentials or file paths | Nothing in the document holds them, and nothing should |
| Room geometry, placements, utility origins | `propose`, `score` and `plan` are not HTTP endpoints. The solver, the scoring engine and the planner run in the browser, so the layout itself never crosses a network |

`GroundingBundle` being assembled at each call site is the load-bearing part: exposure is decided
per question by code a reviewer can read, not by a connection being open.

That last row is worth stating plainly, because revision 2 strengthened it rather than straining it.
Scoring and planning both landed **in the browser**, so the two features most likely to have wanted a
server do not have one; and retrieval-first narrowed what the model contributes to prose over
passages the service already holds. The proportion of this sprint that works with no network went up,
not down — which is the honest test of whether an architecture survives data residency (B-4) being
answered either way.
