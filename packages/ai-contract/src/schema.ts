import { z } from 'zod';

import {
  AI_LANGUAGES,
  type AiRequestContext,
  REFERENCE_POINT_KINDS,
  type ReferencePointSummary,
} from './context';
import { KNOWLEDGE_CORPORA } from './requests';
import { RATIONALE_CODES } from './rationale';
import {
  CITING_SOURCE_KINDS,
  EVIDENCE_SOURCE_KINDS,
  EVIDENCE_STATUSES,
  type EvidenceSourceKind,
  type EvidenceStatus,
  VERIFYING_SOURCE_KINDS,
} from './evidence';
import {
  CITATION_KINDS,
  type AiAnswer,
  type AiExplanation,
  type AiSummary,
  type InstallationPlan,
  type RetrievalResult,
  PLAN_BLOCKER_KINDS,
  PLAN_RISK_ORIGINS,
  PLAN_SERVICES,
  PROPOSAL_CONFIDENCES,
  PROPOSAL_KINDS,
  PROPOSAL_SOURCES,
  PROPOSED_COMMAND_TYPES,
} from './responses';
import {
  CRITERION_DIRECTIONS,
  SCORE_REASON_CODES,
  SCORING_CONSTRAINTS,
  SCORING_CRITERIA,
  type ScoreBreakdown,
  type ScoringModel,
} from './scoring';

/**
 * Schemas. Every response is validated **before the editor looks at it**.
 *
 * Two families of check, guarding two different risks:
 *
 * - **Language responses** come from a model, so the risk is a claim with nothing behind it. Those
 *   checks live in `./validate.ts`, because three of the four are cross-field rules a schema cannot
 *   express — they compare the text against the citations and the citations against the passages.
 * - **Deterministic responses** come from pure TypeScript, so hallucination is not the risk;
 *   arithmetic drift and silent gaps are. Those checks are here, as schema refinements, because they
 *   are expressible as invariants of one object.
 *
 * The distinction matters when adding a check: if it can be stated about a single payload, it
 * belongs here, where nothing can forget to call it.
 */

/** Floating-point tolerance for a sum that was accumulated rather than stated. */
const SUM_EPSILON = 1e-9;

export const bilingualSchema = z.object({
  ko: z.string().min(1),
  en: z.string().min(1),
});

export const vec2Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const refWithVersionSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
});

export const aiRequestContextSchema: z.ZodType<AiRequestContext> = z.object({
  projectId: z.string().min(1),
  levelId: z.string().min(1),
  documentVersion: z.number().int().positive(),
  evaluationResultVersion: z.number().int().positive(),
  aiContractVersion: z.number().int().positive(),
  ruleSetRef: refWithVersionSchema,
  language: z.enum(AI_LANGUAGES),
});

export const referencePointSummarySchema: z.ZodType<ReferencePointSummary> = z.object({
  id: z.string().min(1),
  kind: z.enum(REFERENCE_POINT_KINDS),
  position: vec2Schema,
});

/* ------------------------------------------------------------------ scoring model */

export const criterionConfigSchema = z
  .object({
    weight: z.number().min(0).max(1),
    direction: z.enum(CRITERION_DIRECTIONS),
    reference: z.record(z.string(), z.number()),
    measuredOnly: z.boolean().optional(),
  })
  .refine(
    (config) => Object.values(config.reference).every((value) => value > 0),
    /*
     * A reference of zero is not a stricter requirement, it is an undefined one: "a full score is
     * zero millimetres of pipe" says nothing about two layouts, and dividing by it yields Infinity
     * rather than an error anybody would notice.
     */
    { message: 'every normalisation reference must be positive' },
  );

export const scoringModelSchema: z.ZodType<ScoringModel> = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    /**
     * Owner decision D1's coverage floor. Required rather than defaulted: a scoring model that did
     * not say what it will refuse to score is a model whose silence somebody has to guess at.
     */
    minimumCoverage: z.number().min(0).max(1),
    /*
     * `z.record` with an **enum** key is exhaustive: it rejects an unrecognised key *and* requires
     * every key in the enum. Both halves are load-bearing, and both are properties of this one line
     * rather than of anything below it.
     *
     * | It stops | Which would otherwise be |
     * | --- | --- |
     * | An unknown key — `station_count` | The emptiest-room failure: at any weight, including 0, a station-count criterion makes the one-machine layout the highest-scoring one, because every other criterion improves as machines are removed |
     * | A missing key | A criterion neither scored nor reported unavailable — gone from the breakdown, with nobody told that a fifth of the model was never applied |
     *
     * Two explicit refinements originally said these things. Both were deleted on discovering
     * neither could fire: breaking each left every test green, because the record had already
     * rejected the payload. A guard that cannot fail is not defence in depth, it is a comment
     * shaped like code — so the reasoning lives here, at the mechanism that actually holds.
     *
     * **Widening this to `z.string()` removes both protections**, which is how the tests for them
     * are verified to be capable of failing.
     */
    criteria: z.record(z.enum(SCORING_CRITERIA), criterionConfigSchema),
  }) as z.ZodType<ScoringModel>;

export const criterionScoreSchema = z.object({
  criterion: z.enum(SCORING_CRITERIA),
  measured: z.number().finite(),
  unit: z.string().min(1),
  normalised: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
  contribution: z.number().min(0).max(1),
  measuredOnly: z.boolean(),
});

export const unavailableCriterionSchema = z.object({
  criterion: z.enum(SCORING_CRITERIA),
  reasonCode: z.enum(
    Object.keys(SCORE_REASON_CODES) as [keyof typeof SCORE_REASON_CODES, ...string[]],
  ),
});

export const constraintMeasurementSchema = z.object({
  constraint: z.enum(SCORING_CONSTRAINTS),
  measured: z.number().finite(),
  unit: z.string().min(1),
  target: z.number().int().nonnegative().nullable(),
});

/**
 * `ScoreBreakdown`, with five invariants that a bare type cannot state.
 *
 * Each corresponds to a way a weighted sum can mislead without being wrong-looking, and the two
 * about `measuredOnly` and `constraints` exist because B-5a's reconciliations are the kind of thing
 * a later data edit could quietly undo.
 */
export const scoreBreakdownSchema: z.ZodType<ScoreBreakdown> = z
  .object({
    scoringModel: refWithVersionSchema,
    total: z.number().min(0).max(1).nullable(),
    coverage: z.number().min(0).max(1),
    criteria: z.array(criterionScoreSchema),
    unavailable: z.array(unavailableCriterionSchema),
    constraints: z.array(constraintMeasurementSchema),
  })
  .refine((breakdown) => breakdown.criteria.length > 0, {
    /*
     * Owner requirement, B-5a: "Never display only a single total score." Enforced here rather than
     * in each renderer, so a renderer *cannot be written* that has only the total to show. A rule
     * held in the schema survives a refactor that found the breakdown noisy.
     */
    message:
      'a score must carry its per-criterion breakdown: a bare total is unarguable-with and is ' +
      'forbidden by owner decision B-5a',
  })
  .refine(
    (breakdown) => {
      const seen = new Set([
        ...breakdown.criteria.map((c) => c.criterion),
        ...breakdown.unavailable.map((c) => c.criterion),
      ]);
      return SCORING_CRITERIA.every((criterion) => seen.has(criterion));
    },
    {
      message:
        'every criterion must be either scored or reported unavailable: a criterion quietly ' +
        'dropped is a fifth of the model missing with nothing on screen to say so',
    },
  )
  .refine(
    (breakdown) => {
      const unavailable = new Set(breakdown.unavailable.map((c) => c.criterion));
      return !breakdown.criteria.some((c) => unavailable.has(c.criterion));
    },
    { message: 'a criterion cannot be both measured and reported unavailable' },
  )
  .refine(
    (breakdown) => {
      /*
       * Owner decision D1 suppresses the total below `MINIMUM_COVERAGE`, so there is nothing to
       * check against the sum — and nothing to check it *with*: the contributions are still there,
       * still correct, and deliberately do not add up to a number anybody is being shown.
       */
      if (breakdown.total === null) return true;
      const sum = breakdown.criteria.reduce((total, c) => total + c.contribution, 0);
      return Math.abs(sum - breakdown.total) <= SUM_EPSILON;
    },
    { message: 'total must equal the sum of the contributions' },
  )
  .refine(
    (breakdown) => breakdown.total !== null || breakdown.coverage < 1,
    {
      /*
       * A complete measurement must produce a total. Without this, "suppressed" and "fully measured
       * but silent" would be the same shape, and a bug that dropped every total would validate.
       */
      message: 'a breakdown with full coverage must carry a total',
    },
  )
  .refine(
    (breakdown) => breakdown.criteria.every((c) => !c.measuredOnly || c.contribution === 0),
    {
      /*
       * `drain_routing` acquiring influence through a weight edit that left the flag behind. The
       * flag and the contribution have to agree, or "measured only" is a label rather than a fact.
       */
      message: 'a measuredOnly criterion must contribute exactly 0',
    },
  ) as z.ZodType<ScoreBreakdown>;

/* ------------------------------------------------------------------ proposals */

export const severityCountsSchema = z.object({
  RED: z.number().int().nonnegative(),
  YELLOW: z.number().int().nonnegative(),
  GREEN: z.number().int().nonnegative(),
});

export const proposedCommandSchema = z.object({
  type: z.enum(PROPOSED_COMMAND_TYPES),
  payload: z.record(z.string(), z.unknown()),
});

export const rationaleItemSchema = z.object({
  code: z.enum(Object.keys(RATIONALE_CODES) as [keyof typeof RATIONALE_CODES, ...string[]]),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  refersTo: z.string().min(1).nullable(),
});

export const proposalEvaluationSchema = z.object({
  before: severityCountsSchema,
  after: severityCountsSchema,
  resolves: z.array(z.string().min(1)),
  introduces: z.array(z.string().min(1)),
  score: scoreBreakdownSchema,
});

export const aiProposalSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(PROPOSAL_KINDS),
  source: z.enum(PROPOSAL_SOURCES),
  confidence: z.enum(PROPOSAL_CONFIDENCES),
  rationale: z.array(rationaleItemSchema).min(1),
  commands: z.array(proposedCommandSchema).min(1),
  evaluation: proposalEvaluationSchema,
});

/* ------------------------------------------------------------------ evidence */

/**
 * The seven invariants of `evidence.ts`, as refinements.
 *
 * One refinement per invariant, each named with its `EV-` id, because when one fires the message an
 * engineer sees should say *which rule about evidence* was broken rather than "invalid input". Each
 * is verified by breaking it — a schema check nobody has watched fail is a schema check nobody has
 * tested.
 *
 * EV-6 and EV-7 are B-7's: a planning calculation may name a rate only together with that rate's
 * citation, and a source whose authority *is* an outside document must say which document.
 */
const evidenceSourceSchema = z
  .object({
    kind: z.enum(EVIDENCE_SOURCE_KINDS),
    ref: z.string().min(1),
    citation: z.string().min(1).nullable(),
  })
  .refine((source) => !CITING_SOURCE_KINDS.includes(source.kind) || source.citation !== null, {
    message:
      'EV-7: a standard, a manufacturer manual and an installation rate are authorities *because* ' +
      'of a document. One with no reference is a claim about a document nobody can find',
  });

const calculationSchema = z
  .object({
    formula: z.string().min(1),
    inputs: z
      .array(
        z.object({
          name: z.string().min(1),
          value: z.number().finite(),
          unit: z.string().min(1),
          ref: z.string().min(1),
        }),
      )
      .min(1),
    rateId: z.string().min(1).nullable(),
    citation: z.string().min(1).nullable(),
  })
  .refine((entry) => (entry.rateId === null) === (entry.citation === null), {
    message:
      'EV-6: a planning calculation names a rate only together with that rate\'s citation. ' +
      'B-7: planning calculations may use only sourced installation rates',
  });

function withStatusInvariants<
  T extends z.ZodType<{ status: EvidenceStatus; source: { kind: EvidenceSourceKind } }>,
>(schema: T) {
  return schema
    .refine((entry) => (entry.source.kind === 'not_supplied') === (entry.status === 'unknown'), {
      message:
        'EV-2: a value is sourced `not_supplied` if and only if its status is `unknown` — this is ' +
        '"never generate uncited engineering values" in the only form that cannot be worked around',
    })
    .refine(
      (entry) => entry.status !== 'verified' || VERIFYING_SOURCE_KINDS.includes(entry.source.kind),
      {
        message:
          'EV-5: only a document can verify. A measurement off a drawing is a fact about the ' +
          'drawing, not about the equipment',
      },
    );
}

export const sourcedNumberSchema = withStatusInvariants(
  z
    .object({
      value: z.number().nullable(),
      unit: z.string().min(1),
      status: z.enum(EVIDENCE_STATUSES),
      source: evidenceSourceSchema,
      calculation: calculationSchema.nullable(),
    })
    .refine((entry) => (entry.value === null) === (entry.status === 'unknown'), {
      message:
        'EV-1: a null with any other status is a figure that lost its number; a non-null ' +
        '`unknown` is a guess wearing a disclaimer',
    })
    .refine(
      (entry) =>
        (entry.status === 'calculated') ===
        (entry.source.kind === 'derived' && entry.calculation !== null),
      {
        message:
          'EV-3: `calculated` means computed from something. If no arithmetic is attached, it was ' +
          'not computed — it was chosen',
      },
    ),
);

export const sourcedRangeSchema = withStatusInvariants(
  z
    .object({
      minimum: z.number().nullable(),
      recommended: z.number().nullable(),
      unit: z.string().min(1),
      status: z.enum(EVIDENCE_STATUSES),
      source: evidenceSourceSchema,
    })
    .refine(
      (entry) =>
        (entry.minimum === null) === (entry.status === 'unknown') &&
        (entry.recommended === null) === (entry.status === 'unknown'),
      {
        message:
          'EV-1: both crew figures are absent together. A rate stating only one would leave a ' +
          'reader unable to tell a floor from a recommendation',
      },
    )
    .refine(
      (entry) =>
        entry.minimum === null ||
        entry.recommended === null ||
        entry.recommended >= entry.minimum,
      {
        message:
          'a recommended crew smaller than the minimum is not a recommendation, it is a ' +
          'transcription error in the rate',
      },
    ),
);

export const sourcedTextSchema = withStatusInvariants(
  z
    .object({
      value: bilingualSchema.nullable(),
      status: z.enum(EVIDENCE_STATUSES),
      source: evidenceSourceSchema,
    })
    .refine((entry) => (entry.value === null) === (entry.status === 'unknown'), {
      message: 'EV-1: a statement without text is unknown, and an unknown carries no text',
    }),
);

/** {@link InstallationRate} — every field required, because a partial rate is not a rate (B-7). */
export const installationRateSchema = z.object({
  id: z.string().min(1),
  stage: z.string().min(1),
  hoursFixed: z.number().nonnegative().finite(),
  hoursPerStation: z.number().nonnegative().finite(),
  minimumPersons: z.number().int().positive(),
  recommendedPersons: z.number().int().positive(),
  source: z.string().min(1),
});

/* ------------------------------------------------------------------ installation plan */

const planResourceSchema = z.object({
  id: z.string().min(1),
  title: bilingualSchema,
  quantity: sourcedNumberSchema,
});

const planRiskSchema = z.object({
  id: z.string().min(1),
  origin: z.enum(PLAN_RISK_ORIGINS),
  ref: z.string().min(1),
  title: bilingualSchema,
  detail: sourcedTextSchema,
  stageId: z.string().min(1).nullable(),
});

export const installationStageSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  title: bilingualSchema,
  dependsOn: z.array(z.string().min(1)),
  placementIds: z.array(z.string().min(1)),
  checklistItemIds: z.array(z.string().min(1)),
  tools: z.array(planResourceSchema),
  materials: z.array(planResourceSchema),
  risks: z.array(planRiskSchema),
  manpower: sourcedRangeSchema,
  duration: sourcedNumberSchema,
});

export const planBlockerSchema = z.object({
  kind: z.enum(PLAN_BLOCKER_KINDS),
  ref: z.string().min(1),
  stageId: z.string().min(1).nullable(),
});

const connectionPlanSchema = z.object({
  service: z.enum(PLAN_SERVICES),
  originPointId: z.string().min(1).nullable(),
  runs: z.array(
    z.object({
      placementId: z.string().min(1),
      length: sourcedNumberSchema,
      requirement: sourcedTextSchema,
    }),
  ),
  totalLength: sourcedNumberSchema,
});

const planProvenanceSchema = z.object({
  levelId: z.string().min(1),
  placementCount: z.number().int().nonnegative(),
  ruleSet: refWithVersionSchema,
  evaluationVersion: z.number().int().positive(),
  findingCounts: z.object({
    red: z.number().int().nonnegative(),
    yellow: z.number().int().nonnegative(),
    green: z.number().int().nonnegative(),
  }),
  optimisation: z
    .object({
      candidateId: z.string().min(1),
      scoringModel: refWithVersionSchema,
      total: z.number(),
      coverage: z.number(),
    })
    .nullable(),
  /** Hardening decision 1: what the plan was made from, as comparable strings. */
  fingerprint: z.object({
    documentRevision: z.string().min(1),
    layoutRevision: z.string().min(1),
    equipmentLibraryRevision: z.string().min(1),
    ruleSetRevision: z.string().min(1),
  }),
  generatedAt: z.string().min(1),
});

export const installationPlanSchema: z.ZodType<InstallationPlan> = z
  .object({
    sequenceSet: refWithVersionSchema,
    stages: z.array(installationStageSchema),
    blockers: z.array(planBlockerSchema),
    /*
     * All three services, always. `.length(3)` rather than an array of any size: a plan that
     * omitted drain because nobody placed the point would read as a project with no drain
     * requirement, and the difference between "no requirement" and "nobody said" is the difference
     * this whole package exists to keep.
     */
    connections: z.array(connectionPlanSchema).length(PLAN_SERVICES.length),
    materials: z.array(planResourceSchema),
    risks: z.array(planRiskSchema),
    manpower: sourcedRangeSchema,
    duration: sourcedNumberSchema,
    /*
     * B-7: the report must say *"Planning rate data not available."* instead of numbers when no
     * rate exists. A flag rather than inferring it from a null: a renderer that had to work out
     * why a figure was absent would eventually work it out differently from another renderer.
     */
    ratesAvailable: z.boolean(),
    provenance: planProvenanceSchema,
  })
  .refine(
    (plan) => new Set(plan.connections.map((entry) => entry.service)).size === PLAN_SERVICES.length,
    { message: 'each of power, RO water and drain appears exactly once' },
  )
  .refine(
    (plan) => {
      const ids = new Set(plan.stages.map((stage) => stage.id));
      return plan.risks.every((risk) => risk.stageId === null || ids.has(risk.stageId));
    },
    { message: 'a risk attached to a stage must name a stage in the plan' },
  )
  .refine(
    (plan) => {
      const ids = new Set(plan.stages.map((stage) => stage.id));
      return plan.stages.every((stage) => stage.dependsOn.every((id) => ids.has(id)));
    },
    { message: 'every dependsOn must name a stage in the plan' },
  )
  .refine((plan) => new Set(plan.stages.map((s) => s.id)).size === plan.stages.length, {
    message: 'stage ids must be unique',
  })
  .refine((plan) => isTopologicallyOrdered(plan.stages), {
    /*
     * A plan is read by a site team in the order it prints. A dependency pointing forwards is a
     * plan that cannot be executed as written, and a cycle is not orderable at all — the planner
     * must report that rather than emit some order and let the ambiguity be discovered on site.
     */
    message:
      'stages must print in an order that satisfies their dependencies: a plan whose order ' +
      'contradicts its own prerequisites cannot be executed as written',
  }) as z.ZodType<InstallationPlan>;

/**
 * True when each stage's `order` is strictly greater than every stage it depends on.
 *
 * Checks the *printed* order rather than merely the absence of a cycle, and that is deliberate:
 * an acyclic graph printed in the wrong sequence is still a plan somebody would follow wrongly. A
 * cycle fails this too, since no assignment of orders can satisfy it.
 */
function isTopologicallyOrdered(
  stages: readonly { id: string; order: number; dependsOn: readonly string[] }[],
): boolean {
  const orderById = new Map(stages.map((stage) => [stage.id, stage.order]));
  return stages.every((stage) =>
    stage.dependsOn.every((id) => {
      const dependencyOrder = orderById.get(id);
      return dependencyOrder !== undefined && dependencyOrder < stage.order;
    }),
  );
}

/* ------------------------------------------------------------------ language responses */

export const citationSchema = z.object({
  kind: z.enum(CITATION_KINDS),
  ref: z.string().min(1),
  span: z
    .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
    .refine((span) => span.end > span.start, { message: 'a span must be non-empty' })
    .nullable(),
});

export const retrievedPassageSchema = z.object({
  id: z.string().min(1),
  corpus: z.enum(KNOWLEDGE_CORPORA),
  text: z.string().min(1),
  source: z.object({
    document: z.string().min(1),
    revision: z.string().min(1).nullable(),
    section: z.string().min(1).nullable(),
    page: z.number().int().positive().nullable(),
  }),
  relevance: z.number().min(0).max(1),
});

export const retrievalResultSchema: z.ZodType<RetrievalResult> = z
  .object({
    query: z.string().min(1),
    passages: z.array(retrievedPassageSchema),
    empty: z.boolean(),
    searched: z.array(z.enum(KNOWLEDGE_CORPORA)),
  })
  .refine((result) => result.empty === (result.passages.length === 0), {
    /*
     * `empty` is the field a caller branches on to decide whether to invoke a model at all. If it
     * could disagree with `passages`, the retrieval-first guarantee would rest on a boolean nobody
     * had checked against the thing it describes.
     */
    message: 'empty must agree with whether any passage was returned',
  }) as z.ZodType<RetrievalResult>;

/**
 * The shape shared by every response a model contributed prose to.
 *
 * `retrieved` is `.min(1)` **here, in the schema** — the structural half of AD-16. A well-formed
 * answer with no passages behind it is an answer from memory, and there is no such response.
 */
const languageResponseFields = {
  text: bilingualSchema,
  citations: z.array(citationSchema),
  retrieved: z.array(retrievedPassageSchema).min(1),
};

export const aiExplanationSchema: z.ZodType<AiExplanation> = z.object({
  subject: z.string().min(1),
  ...languageResponseFields,
});

export const aiAnswerSchema: z.ZodType<AiAnswer> = z.object({
  ...languageResponseFields,
  insufficientGrounding: z.boolean(),
});

export const aiSummarySchema: z.ZodType<AiSummary> = z.object({
  ...languageResponseFields,
  coveredSections: z.array(z.string().min(1)).min(1),
});
