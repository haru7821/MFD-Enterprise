import type { PlacementSummary, RefWithVersion, ReferencePointSummary } from './context';
import type { InstallationPlan } from './responses';
import type { ScoreBreakdown } from './scoring';

/**
 * The planner boundary.
 *
 * > Owner decision, Sprint 6 § 7: *"Introduce AiPlanner API only as an abstraction layer. The
 * > deterministic planner is the default implementation. Future LLM implementations may summarize
 * > planner output but must never replace planning logic."*
 *
 * ## Two interfaces, and the second is why there are two
 *
 * {@link AiPlanner} produces a plan. {@link PlanSummariser} takes a plan and produces prose. The
 * separation is the requirement: a summariser's method **accepts** an `InstallationPlan` and
 * returns text, so no implementation of it can produce a plan — not by policy, by signature.
 *
 * A single `plan()` method on one interface would have made "an LLM planner" a legal
 * implementation, and *"must never replace planning logic"* would have been a comment. This way the
 * sentence is a type error.
 */

/**
 * A planner. Deterministic and offline, and both are in the type.
 *
 * `requiresNetwork: false` is a **literal** type rather than a boolean. An implementation that
 * needed a network could not set it to `true` — the field would not compile — so it could not
 * satisfy this interface at all. That is the owner's § 6 (*"must work completely offline. No LLM
 * required. No cloud dependency."*) expressed where a reviewer can see it.
 *
 * `plan` is synchronous for the same reason: a Promise is the shape of something that might go over
 * a wire, and this cannot.
 */
export interface AiPlanner {
  readonly id: string;
  readonly sequenceSet: RefWithVersion;
  readonly requiresNetwork: false;
  plan(input: PlanInput): InstallationPlan;
}

/**
 * Something that renders a finished plan into prose.
 *
 * The only place a model may touch a plan, and it may not touch the planning. It receives the plan
 * as an argument and returns text — it cannot reorder a stage, add one, or invent a duration,
 * because it is never asked for a plan and has nothing to return one through.
 *
 * Nothing implements this yet. It exists now so that when something does, the shape it has to fit
 * is already decided and already narrow.
 */
export interface PlanSummariser {
  readonly id: string;
  summarise(plan: InstallationPlan, language: 'ko' | 'en'): Promise<string>;
}

/**
 * What a planner is allowed to see.
 *
 * > Owner decision, Sprint 6 §§ 1–2: *"AI Planner receives only validated layouts. Never plan
 * > directly from raw user drawings … Only validated data may enter the planner."*
 *
 * ## `evaluation` is required, and that is the enforcement
 *
 * Not `evaluation?:`, not `evaluation: X | null`. A caller holding an unevaluated drawing **cannot
 * construct this object**, so there is no code path from a raw drawing to a plan — the requirement
 * is a compile error rather than a check somebody could forget to write.
 *
 * The owner's list of what the planner consumes maps onto these fields one to one:
 *
 * | Owner's list | Field |
 * | --- | --- |
 * | Project, Level, Space | `projectId`, `levelId`, `spaceId` |
 * | Placements | `placements` |
 * | Equipment Objects | `equipment` |
 * | Evaluation Results | `evaluation` — **required** |
 * | Optimization Results | `optimisation` — nullable, because a hand-drawn layout is legitimate |
 *
 * `optimisation` is the one nullable member of that list, and deliberately: a layout an engineer
 * drew and validated is as plannable as one the solver produced. What may not be missing is the
 * *validation*.
 */
export interface PlanInput {
  readonly projectId: string;
  readonly levelId: string;
  /** The room being planned, or null for a whole level. */
  readonly spaceId: string | null;
  readonly placements: readonly PlacementSummary[];
  readonly equipment: readonly PlanEquipment[];
  readonly referencePoints: readonly ReferencePointSummary[];
  readonly evaluation: PlanEvaluation;
  readonly optimisation: PlanOptimisation | null;
  /**
   * Routed lengths from each service origin to each machine, measured by the caller.
   *
   * Measured **by the caller**, because routing is `ai-local`'s geometry and a planner that
   * re-derived it could disagree with the number the engineer was shown when they approved the
   * layout. Absent entries become `unknown` rather than a straight-line fallback: a straight line
   * through a wall is not a shorter route, it is a wrong one.
   */
  readonly routedLengths: readonly RoutedLength[];
  readonly checklistItemIds: readonly string[];
  /**
   * Whether the level's plan drawing is calibrated.
   *
   * Carried because an uncalibrated plan makes every measured length a number in pixels wearing a
   * millimetre label, and `uncalibrated_level` is a blocker rather than a footnote.
   */
  readonly planStatus: 'none' | 'calibrated' | 'uncalibrated';
}

/** One equipment record, reduced to what a plan needs — and to what it may state. */
export interface PlanEquipment {
  readonly id: string;
  readonly version: string;
  readonly model: string;
  /**
   * Whether the catalogue record's field groups are verified or draft.
   *
   * Carried so a figure taken from this record inherits its status. A planner that read a draft
   * dimension and reported a `verified` material quantity would undo the object library's whole
   * verification mechanism from one package over.
   */
  readonly dataStatus: 'verified' | 'draft';
  /**
   * What this machine has to be connected to, from the catalogue's `connections` group.
   *
   * The bill of materials is derived from here rather than declared in the sequence file, because
   * *"a dialysis machine needs one power connection"* is a fact about the equipment record and not
   * about the site's construction sequence. The sequence file says only **which stage** those
   * materials belong to.
   */
  readonly connections: readonly PlanEquipmentConnection[];
}

export interface PlanEquipmentConnection {
  readonly service: 'power' | 'ro_water' | 'drain';
  readonly required: boolean;
  /** The fitting or rating the catalogue states. Null on every record today (A-1). */
  readonly specification: string | null;
  /** The field group's own verification state, carried so a figure taken from it inherits it. */
  readonly status: 'verified' | 'draft';
}

export interface PlanEvaluation {
  readonly version: number;
  readonly ruleSet: RefWithVersion;
  readonly red: number;
  readonly yellow: number;
  readonly green: number;
  /** Open findings, so the plan can lead with a blocker rather than sequence past one. */
  readonly openFindings: readonly PlanFinding[];
}

export interface PlanFinding {
  readonly ruleId: string;
  readonly reasonCode: string;
  readonly level: 'RED' | 'YELLOW' | 'GREEN';
  readonly placementId: string | null;
}

export interface PlanOptimisation {
  readonly candidateId: string;
  readonly score: ScoreBreakdown;
}

export interface RoutedLength {
  readonly service: 'power' | 'ro_water' | 'drain';
  readonly placementId: string;
  readonly originPointId: string;
  /** Millimetres, routed around obstructions. */
  readonly millimetres: number;
}
