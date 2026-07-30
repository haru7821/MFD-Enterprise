# AI Service API

> **For review. Not implemented.**
> The contract between the editor and the AI, in both directions.
> Companion to [AI_SYSTEM_ARCHITECTURE.md](AI_SYSTEM_ARCHITECTURE.md).

---

## A. One interface, two implementations

```ts
// packages/ai-contract/src/client.ts — pure TypeScript, no AI in it.

export interface AiClient {
  /** Which capabilities this implementation actually has. */
  readonly capabilities: readonly AiCapability[];

  propose(request: ProposalRequest): Promise<AiProposal[]>;
  explain(request: ExplainRequest): Promise<AiExplanation>;
  ask(request: QueryRequest): Promise<AiAnswer>;
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>;
  summarise(request: SummaryRequest): Promise<AiSummary>;
}

export const AI_CAPABILITIES = [
  'propose_placement',
  'propose_layout',
  'optimise_layout',
  'recommend_installation',
  'explain_rule',
  'explain_finding',
  'answer_query',
  'retrieve_knowledge',
  'summarise_report',
] as const;
```

**`capabilities` is not decoration.** `ai-local` reports the four it can do offline and the editor
hides the rest; `ai-service` reports the language ones. A composite client that delegates per
capability is how the two are used together, and it is why the editor asks *what can you do*
rather than *are you the local one*.

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
  readonly objective: LayoutObjective;
}

export interface LayoutObjective {
  /**
   * What makes one satisfying layout better than another.
   *
   * **This is [OPEN_QUESTIONS](../OPEN_QUESTIONS.md) B-5, and it is still open.** Until it is
   * answered the solver optimises `station_count` and reports the others as measured figures
   * rather than ranking on them — a ranking on an objective nobody chose is a preference
   * disguised as an optimisation.
   */
  readonly primary: 'station_count' | 'staff_walking_distance' | 'service_run_length';
  readonly minimumClearanceMargin: number;
}
```

`existing` carries a *summary* — id, transform, catalogue id — not equipment records. The solver
resolves dimensions from the catalogue itself, so a proposal cannot rest on a stale copy of a
footprint. That is the same rule that makes a `Placement` reference a catalogue entry rather than
embed one.

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
}
```

**`introduces` is not optional and not omitted when empty.** A proposal that lists what it fixes
and not what it breaks is the single most misleading thing this feature could produce, and an
absent field and an empty one must not look the same.

**`evaluation` is computed by the editor, not by the service.** The client applies the proposed
commands to a copy of the document, runs `evaluate()`, and fills this in before showing anything.
A service-supplied evaluation would be a claim about the rule engine made by something that is not
the rule engine.

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
}
```

---

## D. Transport

| | |
| --- | --- |
| Protocol | HTTP, JSON, `POST /v1/{propose,explain,ask,retrieve,summarise}` |
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
it**. Three checks are not stylistic:

1. **Bilingual completeness.** `text.ko` and `text.en` both non-empty, or the response is
   rejected. The same rule the report labels follow.
2. **Every number is cited.** A response whose text contains a digit sequence with no `Citation`
   covering it is rejected. This is the mechanism behind AD-13 — a model cannot get a hallucinated
   figure onto the screen by writing it in a sentence.
3. **Every citation resolves.** A `ref` naming a rule, finding or catalogue field that does not
   exist in what the request supplied is rejected. A plausible-looking citation to a section that
   does not exist is worse than no citation.

Check 2 has a false-positive cost — a model writing "one of the four sides" gets rejected for the
digit — and I would rather pay it. The failure it prevents is a number in a document a hospital
acts on; the failure it causes is an assistant that occasionally says it could not answer.

**Sourced values are rendered from the source, not from the text.** The model returns a template
with slots (`{finding.measured}`); the client substitutes from the engine output. That is what
makes point 2 an enforcement rather than a hope: even a response that passes validation cannot
display a figure the model chose.

---

## F. What the service never receives

| | Why |
| --- | --- |
| The plan image | Most identifying artefact in the project; no feature needs it; megabytes |
| The whole `MfdDocument` | A request carries what answers it. `GroundingBundle` is assembled per call. |
| Customer contact details | Not needed to answer an engineering question |
| Credentials or file paths | Nothing in the document holds them, and nothing should |

`GroundingBundle` being assembled at each call site is the load-bearing part: exposure is decided
per question by code a reviewer can read, not by a connection being open.
