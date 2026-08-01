import type { Vec2 } from '@mfd/cad-engine';
import { type Boundary, createBoundary, createObstruction } from '@mfd/document-model';
import { aggregate, createKnowledgeBase, type KnowledgeBase } from '@mfd/layout-knowledge';
import { type Catalog, type EquipmentObject, createCatalog } from '@mfd/object-library';
import { type RuleSet, createRuleSet } from '@mfd/rule-engine';

/**
 * Solver fixtures.
 *
 * Written here rather than imported from the report engine's, deliberately: the solver must not
 * depend on the report engine, and a shared fixture would create exactly that edge for the sake of
 * saving forty lines.
 *
 * Every figure here is **invented**, and the same discipline applies as everywhere else in this
 * codebase: a 1,200 mm in a fixture must never be mistakable for a manual value, so the source
 * type is `estimate` and every group is draft.
 */

const DRAFT_GROUP = {
  status: 'draft',
  source: {
    document: null,
    revision: null,
    section: null,
    type: 'estimate',
    lastUpdated: '2026-07-30',
  },
} as const;

export interface FixtureMachineOptions {
  readonly id?: string;
  readonly width?: number;
  readonly depth?: number;
}

export function fixtureMachineRecord(
  options: FixtureMachineOptions = {},
): Record<string, unknown> {
  return {
    id: options.id ?? 'fixture_station',
    manufacturer: 'Fixture Co',
    model: 'FX-1',
    category: 'dialysis_machine',
    version: '1.0.0',
    manufacturerDimensions: {
      width: 585,
      depth: 620,
      height: 1_305,
      weight: null,
      verification: DRAFT_GROUP,
    },
    planningFootprint: {
      width: options.width ?? 800,
      depth: options.depth ?? 800,
      basis: 'Fixture planning allowance',
    },
    connections: {
      power: { required: true, specification: null, verification: DRAFT_GROUP },
      roWater: { required: true, specification: null, verification: DRAFT_GROUP },
      drain: { required: true, specification: null, verification: DRAFT_GROUP },
    },
    serviceClearance: {
      front: 1_200,
      rear: 800,
      left: 400,
      right: 400,
      verification: DRAFT_GROUP,
    },
    environmental: { specification: null, verification: DRAFT_GROUP },
    maintenanceAccess: { front: null, rear: null, left: null, right: null, verification: DRAFT_GROUP },
    portLocations: { power: null, roWater: null, drain: null, verification: DRAFT_GROUP },
    installationRouting: { specification: null, verification: DRAFT_GROUP },
    symbol: { origin: 'front-left', outline: 'rectangle', frontEdge: 'south' },
  };
}

/**
 * A second kind, so that "a machine of another kind" means one.
 *
 * 1,000 x 2,100 mm against the station's 800 x 800 — the shipped catalogue's real spread, a
 * dialysis bed beside an AK98. The fixture catalogue held a **single** record until the standing
 * review pointed out what that costs: every test claiming to place "equipment of another kind" was
 * placing another station at the same footprint, so a criterion that sized every occupant from the
 * measured object could not be caught by any of them.
 */
export function fixtureBedRecord(): Record<string, unknown> {
  return {
    ...fixtureMachineRecord({ id: 'fixture_bed' }),
    model: 'FX-BED',
    category: 'treatment_bed',
    planningFootprint: { width: 1_000, depth: 2_100, basis: 'Fixture planning allowance' },
  };
}

export function fixtureCatalog(options: FixtureMachineOptions = {}): Catalog {
  return createCatalog([
    { fileName: 'fixture_station.json', raw: fixtureMachineRecord(options) },
    { fileName: 'fixture_bed.json', raw: fixtureBedRecord() },
  ]);
}

export function fixtureMachine(options: FixtureMachineOptions = {}): EquipmentObject {
  const object = fixtureCatalog(options).get(options.id ?? 'fixture_station');
  if (!object) throw new Error('fixture catalogue did not contain its own machine');
  return object;
}

/**
 * A collision rule that produces **RED**.
 *
 * Gate 2 is about violations, and on this project almost nothing produces one: every clearance
 * finding is YELLOW because no threshold has been supplied (A-1). So a fixture that only carried
 * clearance rules would let a broken Gate 2 pass every test — there would be no RED for it to fail
 * to catch. This is the rule that makes the gate testable.
 */
export function fixtureCollisionRule(
  options: { ruleId?: string; scope?: 'equipment' | 'boundary' } = {},
): Record<string, unknown> {
  return {
    ruleId: options.ruleId ?? 'fixture_overlap',
    category: 'collision',
    name: { ko: '테스트 간섭', en: 'Fixture Overlap' },
    description: { ko: '테스트용 간섭 규정', en: 'Fixture collision rule' },
    threshold: null,
    unit: 'mm',
    status: 'draft',
    severity: 'RED',
    appliesTo: { equipmentIds: null, categories: ['dialysis_machine'] },
    parameters: { scope: options.scope ?? 'equipment' },
    source: {
      document: null,
      revision: null,
      section: null,
      type: 'estimate',
      lastUpdated: '2026-07-30',
    },
  };
}

/**
 * A clearance rule with a **real threshold**.
 *
 * The shipped rule set has none — every threshold is null until the AK98 manual arrives (A-1) — so
 * compliance margin is unmeasurable on any realistic fixture, and the code that computes it is
 * never reached. This rule is what makes that arithmetic testable, and it is deliberately kept out
 * of the default set so the *default* fixture keeps reflecting the product's actual state.
 */
export function fixtureClearanceRule(
  options: {
    ruleId?: string;
    side?: 'front' | 'rear' | 'left' | 'right';
    threshold?: number;
    categories?: readonly string[];
  } = {},
): Record<string, unknown> {
  return {
    ruleId: options.ruleId ?? 'fixture_front_clearance',
    category: 'clearance',
    name: { ko: '테스트 정비 공간', en: 'Fixture Service Clearance' },
    description: { ko: '테스트용 정비 공간 규정', en: 'Fixture clearance rule' },
    threshold: options.threshold ?? 1_200,
    unit: 'mm',
    status: 'draft',
    severity: 'YELLOW',
    appliesTo: { equipmentIds: null, categories: options.categories ?? ['dialysis_machine'] },
    parameters: { side: options.side ?? 'front' },
    source: {
      document: null,
      revision: null,
      section: null,
      type: 'estimate',
      lastUpdated: '2026-07-30',
    },
  };
}

export function fixtureRuleSet(
  records: readonly Record<string, unknown>[] = [
    fixtureCollisionRule(),
    fixtureCollisionRule({ ruleId: 'fixture_boundary', scope: 'boundary' }),
  ],
): RuleSet {
  return createRuleSet(
    records.map((raw, index) => ({ fileName: `fixture_rule_${index}.json`, raw })),
    { id: 'fixture', version: '0.0.1' },
  );
}

/** A rectangular room, origin at (0, 0). 8 m × 6 m by default — room for a dozen 800 mm stations. */
export function fixtureRoom(width = 8_000, depth = 6_000): Vec2[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: depth },
    { x: 0, y: depth },
  ];
}

export function fixtureRoomBoundary(width = 8_000, depth = 6_000): Boundary {
  return createBoundary('boundary-room', 'space_outline', fixtureRoom(width, depth), 'Ward');
}

/**
 * A column, for the obstruction path.
 *
 * `id` and `label` are arguments so a test can put **two different** obstructions on a drawing.
 * They were fixed strings until the two-obstruction case had to be tested, and two columns that
 * are indistinguishable are not a test of telling obstructions apart.
 */
export function fixtureColumn(
  at: Vec2 = { x: 3_000, y: 2_500 },
  size = 600,
  { id = 'boundary-column', label = 'Column C4' }: { id?: string; label?: string } = {},
): Boundary {
  return createObstruction(
    id,
    'column',
    [
      { x: at.x, y: at.y },
      { x: at.x + size, y: at.y },
      { x: at.x + size, y: at.y + size },
      { x: at.x, y: at.y + size },
    ],
    label,
  );
}

/**
 * A knowledge base for the solver fixtures.
 *
 * Empty by default, because that is what the shipped one is: no drawing has been observed, so
 * `installation_feasibility` reports `SC-905` and the tests see what an engineer sees today.
 *
 * `withDeliveryAllowance` builds one that *can* answer, for the tests that are about the criterion
 * rather than about its absence. Three drawings, because `PATTERN_SUPPORT_THRESHOLD` is three and a
 * fixture that squeaked under it would make those tests pass for the wrong reason.
 */
export function fixtureKnowledge(): KnowledgeBase {
  return createKnowledgeBase([]);
}

export function withDeliveryAllowance(millimetres: readonly number[]): KnowledgeBase {
  const observations = millimetres.map((value, index) => ({
    id: `obs-${index}`,
    source: {
      drawing: {
        datasetId: 'fixture',
        drawingId: `fixture-drawing-${index}`,
        path: `fixtures/${index}.pdf`,
        page: 0,
        sheet: null,
        revision: null,
        sha256: null,
      },
      method: 'dimension_line' as const,
      observer: { type: 'human' as const, name: 'Fixture Engineer', version: null },
      observationDate: '2026-07-31',
      confidence: 'high' as const,
      note: null,
    },
    value: {
      kind: 'common_dimension' as const,
      name: 'delivery_crate_allowance' as const,
      millimetres: value,
      roomFunction: null,
    },
  }));

  return createKnowledgeBase(aggregate(observations, ['fixture']));
}
