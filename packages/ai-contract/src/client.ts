import type {
  ExplainRequest,
  PlanRequest,
  ProposalRequest,
  QueryRequest,
  RetrievalRequest,
  ScoreRequest,
  SummaryRequest,
} from './requests';
import type {
  AiAnswer,
  AiExplanation,
  AiProposal,
  AiSummary,
  InstallationPlan,
  RetrievalResult,
} from './responses';
import type { ScoreBreakdown } from './scoring';

/**
 * One interface, three implementations.
 *
 * | | `ai-local` | `ai-planner` | `ai-service` |
 * | --- | --- | --- | --- |
 * | What | Solver and scoring engine | Installation sequencer | Knowledge engine + LLM |
 * | Runs | In the browser, offline | In the browser, offline | Over HTTP |
 * | Reproducible | **Yes** | **Yes** | No |
 * | Needed for a signed report | Yes | Yes | No |
 *
 * There is **no AI in this file and none in this package.** That is the point of the name: it is
 * the vocabulary in which a request and a proposal are expressed, and it would be equally valid if
 * the other side were a person.
 */
export interface AiClient {
  /** Which capabilities this implementation actually has. */
  readonly capabilities: readonly AiCapability[];

  // Deterministic. `ai-local` and `ai-planner`; no model, no network.
  propose(request: ProposalRequest): Promise<readonly AiProposal[]>;
  score(request: ScoreRequest): Promise<ScoreBreakdown>;
  plan(request: PlanRequest): Promise<InstallationPlan>;

  /**
   * The knowledge engine. **A stage, not a convenience.**
   *
   * Every language method below is defined as retrieval followed by reasoning, and a service
   * enforces that internally: `explain`, `ask` and `summarise` call the engine first and pass the
   * passages to the model as a required argument. This is exposed separately because it is useful
   * on its own — an engineer searching indexed manuals needs no model at all.
   */
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>;

  // Language. Each retrieves first; none can be answered from memory (AD-16).
  explain(request: ExplainRequest): Promise<AiExplanation>;
  ask(request: QueryRequest): Promise<AiAnswer>;
  summarise(request: SummaryRequest): Promise<AiSummary>;
}

/**
 * What an implementation can do.
 *
 * **Not decoration.** `ai-local` reports the five it can do offline, `ai-planner` reports
 * `plan_installation`, and `ai-service` reports only what it is configured for — a deployment with
 * an index but no model key reports `retrieve_knowledge` alone, which is supported rather than
 * broken. The editor asks *what can you do* rather than *which one are you*, so a composite client
 * that delegates per capability is how the three are used together.
 */
export const AI_CAPABILITIES = [
  // ai-local — a solver and a weighted scoring engine, with the rule engine as the oracle
  'propose_placement',
  'propose_layout',
  'optimise_layout',
  'score_layout',
  'recommend_installation',
  // ai-planner — dependency ordering, not language
  'plan_installation',
  // the knowledge engine — a search index. No LLM required, which is why it sits on its own.
  'retrieve_knowledge',
  // the LLM, each of which is retrieval-first
  'explain_rule',
  'explain_finding',
  'explain_plan',
  'answer_query',
  'summarise_report',
] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

/**
 * The capabilities that need a language model.
 *
 * Six of the nine features do not appear here, and that is the sprint's shape rather than a
 * coincidence: layout, scoring, planning, recommendation and retrieval are all reproducible and all
 * run without a network.
 */
export const LLM_CAPABILITIES: readonly AiCapability[] = [
  'explain_rule',
  'explain_finding',
  'explain_plan',
  'answer_query',
  'summarise_report',
];

export function requiresLlm(capability: AiCapability): boolean {
  return LLM_CAPABILITIES.includes(capability);
}
