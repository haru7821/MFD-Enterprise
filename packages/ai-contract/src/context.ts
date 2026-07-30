import type { Vec2 } from '@mfd/cad-engine';
import type { Bilingual, ReasonParams } from '@mfd/rule-engine';

/**
 * What every AI request carries, and the summaries it carries instead of documents.
 *
 * The rule that shapes this file: **a request carries the minimum that answers it, never the
 * document.** Three reasons, in the order they matter — a plan image is the most identifying
 * artefact in a project and no feature needs it; `MfdDocument` is megabytes with a raster
 * embedded; and data residency is unanswered, so a contract that structurally cannot send the
 * drawing is one that stays valid whichever way that question is decided.
 *
 * See docs/architecture/AI_SERVICE_API.md § B.
 */

export const AI_CONTRACT_VERSION = 1;

/** Which language the assistant answers in. The report's own convention. */
export const AI_LANGUAGES = ['ko', 'en', 'both'] as const;
export type AiLanguage = (typeof AI_LANGUAGES)[number];

export interface AiRequestContext {
  /** For correlating a proposal with the thing it was made against. */
  readonly projectId: string;
  readonly levelId: string;
  /**
   * The contracts in play, so a stale implementation can **refuse rather than guess**.
   *
   * Reading the fields it recognises and ignoring the rest is how a service ends up explaining a
   * finding using a field that changed meaning. A mismatch is an unavailable capability.
   */
  readonly documentVersion: number;
  readonly evaluationResultVersion: number;
  readonly aiContractVersion: number;
  readonly ruleSetRef: RefWithVersion;
  readonly language: AiLanguage;
}

export interface RefWithVersion {
  readonly id: string;
  readonly version: string;
}

/**
 * A placed machine, as a *reference* rather than a copy.
 *
 * `equipmentObjectId` and not a footprint: the solver resolves dimensions from the catalogue, so a
 * proposal cannot rest on a stale copy of a figure that has since been corrected. The same rule
 * that makes a `Placement` point at a catalogue entry instead of embedding one.
 */
export interface PlacementSummary {
  readonly placementId: string;
  readonly equipmentObjectId: string;
  readonly position: Vec2;
  /** Degrees, clockwise, as everywhere else in the document. */
  readonly rotation: number;
  readonly spaceId: string | null;
}

/**
 * A named point on the level that a criterion measures **from**.
 *
 * New in Sprint 6; requires `DOCUMENT_VERSION` 4.
 *
 * ## Why this is not called `UtilityOrigin`
 *
 * It was, in the first two revisions of the architecture, when the five kinds were all services.
 * B-5a added installation feasibility and walking distance, which measure from a goods entrance
 * and a nurse base — neither of which is a utility. A type whose name describes five of its seven
 * values is a small inaccuracy that would have survived into a migration, so it was renamed
 * before anything was built.
 */
export const REFERENCE_POINT_KINDS = [
  'ro_supply',
  'ro_return',
  'drain',
  'electrical_panel',
  'data',
  /** Where equipment is delivered onto the level. `installation_feasibility` measures from it. */
  'access_entry',
  /** Nurse station or staff base. `walking_distance` measures from it. */
  'staff_base',
] as const;
export type ReferencePointKind = (typeof REFERENCE_POINT_KINDS)[number];

export interface ReferencePointSummary {
  readonly id: string;
  readonly kind: ReferencePointKind;
  readonly position: Vec2;
}

/** A traced polygon — a room to work in, or something in the way. */
export interface PolygonSummary {
  readonly vertices: readonly Vec2[];
  readonly name: string;
}

export interface ObstructionSummary {
  readonly vertices: readonly Vec2[];
  readonly kind: string;
}

/**
 * A finding, as **facts** rather than as the sentence the report prints.
 *
 * Handing a model prose and asking it to elaborate is how it ends up restating a number it did
 * not check. It gets the code, the parameters and the citation, and is asked what that means for
 * an installation.
 */
export interface FindingFacts {
  readonly reasonCode: string;
  readonly reasonParams: ReasonParams;
  readonly severity: 'RED' | 'YELLOW' | 'GREEN';
  readonly ruleId: string;
  readonly ruleName: Bilingual;
  readonly appliedThreshold: number | null;
  readonly measured: number | null;
  readonly unit: string;
  readonly thresholdOrigin: 'rule' | 'equipment' | 'none';
  readonly source: SourceFacts;
  readonly verification: 'verified' | 'draft';
}

export interface SourceFacts {
  readonly document: string | null;
  readonly revision: string | null;
  readonly section: string | null;
}

export interface RuleFacts {
  readonly ruleId: string;
  readonly name: Bilingual;
  readonly description: Bilingual;
  readonly threshold: number | null;
  readonly unit: string;
  readonly status: 'draft' | 'verified';
  readonly source: SourceFacts;
}

export interface EquipmentFacts {
  readonly equipmentObjectId: string;
  readonly name: Bilingual;
  readonly manufacturer: string | null;
  /** Field-group verification, as Phase 4.5 established it. Never a single record-level flag. */
  readonly groups: readonly EquipmentGroupFacts[];
}

export interface EquipmentGroupFacts {
  readonly group: string;
  readonly status: 'draft' | 'verified';
  readonly source: SourceFacts;
}

export interface LevelFacts {
  readonly levelId: string;
  readonly name: string;
  readonly calibrated: boolean;
  readonly placementCount: number;
  readonly spaceCount: number;
}
