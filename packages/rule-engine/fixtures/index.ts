import type { Boundary, BoundaryKind } from '@mfd/document-model';
import { type Placement, createPlacement } from '@mfd/document-model';
import { type Catalog, createCatalog } from '@mfd/object-library';
import type { Vec2 } from '@mfd/cad-engine';

import { type RuleSet, createRuleSet } from '../src/ruleSet';

/**
 * Test fixtures.
 *
 * **These are not shipped rules.** They carry invented threshold figures, which the
 * shipped rule set in `standards/rules/` deliberately does not: an evaluator cannot
 * be tested against a null. Keeping the two apart is the point — if a fixture's
 * 1200 mm ever reached `standards/`, the application would be presenting an
 * invented figure as an engineering requirement, which is the exact failure this
 * product exists to prevent.
 *
 * Every fixture rule is `status: "draft"` with `source.type: "estimate"`, so even
 * inside the tests nothing here can pass itself off as manual-derived.
 */

const DRAFT_SOURCE = {
  document: null,
  revision: null,
  section: null,
  type: 'estimate',
  lastUpdated: '2026-07-29',
} as const;

const VERIFIED_SOURCE = {
  document: 'Fixture Manual',
  revision: 'Rev. 1',
  section: '1.1 Fixture clearances',
  type: 'manufacturer_manual',
  lastUpdated: '2026-07-29',
} as const;

export interface FixtureEquipmentOptions {
  readonly id?: string;
  readonly width?: number;
  readonly depth?: number;
  readonly dataStatus?: 'draft' | 'verified';
  readonly serviceClearance?: {
    front: number | null;
    rear: number | null;
    left: number | null;
    right: number | null;
  };
}

export function fixtureEquipmentRecord(
  options: FixtureEquipmentOptions = {},
): Record<string, unknown> {
  const verified = options.dataStatus === 'verified';

  return {
    id: options.id ?? 'fixture_machine',
    manufacturer: 'Fixture',
    model: 'FX1',
    category: 'dialysis_machine',
    version: '0.1.0',
    dataStatus: options.dataStatus ?? 'draft',
    dimensions: {
      width: options.width ?? 900,
      depth: options.depth ?? 750,
      height: null,
      weight: null,
    },
    connections: {
      power: { required: true, port: null, specification: null },
      roWater: { required: true, port: null, specification: null },
      drain: { required: true, port: null, specification: null },
    },
    serviceClearance: options.serviceClearance ?? {
      front: null,
      rear: null,
      left: null,
      right: null,
    },
    source: verified
      ? {
          document: 'Fixture Manual',
          revision: 'Rev. 1',
          section: '2.0 Dimensions',
          type: 'manufacturer_manual',
          lastUpdated: '2026-07-29',
        }
      : { ...DRAFT_SOURCE },
    symbol: { origin: 'front-left', outline: 'rectangle', frontEdge: 'south' },
  };
}

export function fixtureCatalog(
  records: readonly Record<string, unknown>[] = [fixtureEquipmentRecord()],
): Catalog {
  return createCatalog(
    records.map((raw, index) => ({ fileName: `fixture_${index}.json`, raw })),
  );
}

export interface FixtureClearanceRuleOptions {
  readonly ruleId?: string;
  readonly side?: 'front' | 'rear' | 'left' | 'right';
  readonly threshold?: number | null;
  readonly status?: 'draft' | 'verified';
  readonly severity?: 'RED' | 'YELLOW';
  readonly equipmentIds?: string[] | null;
  readonly categories?: string[] | null;
}

export function fixtureClearanceRule(
  options: FixtureClearanceRuleOptions = {},
): Record<string, unknown> {
  const status = options.status ?? 'draft';

  return {
    ruleId: options.ruleId ?? 'fixture_front_clearance',
    category: 'clearance',
    description: 'Fixture clearance rule',
    threshold: options.threshold === undefined ? 1_200 : options.threshold,
    unit: 'mm',
    status,
    severity: options.severity ?? 'RED',
    appliesTo: {
      equipmentIds:
        options.equipmentIds === undefined ? ['fixture_machine'] : options.equipmentIds,
      categories: options.categories ?? null,
    },
    parameters: { side: options.side ?? 'front' },
    source: status === 'verified' ? { ...VERIFIED_SOURCE } : { ...DRAFT_SOURCE },
  };
}

export function fixtureCollisionRule(
  options: { ruleId?: string; status?: 'draft' | 'verified'; scope?: 'equipment' | 'boundary' } = {},
): Record<string, unknown> {
  const status = options.status ?? 'draft';

  return {
    ruleId: options.ruleId ?? 'fixture_overlap',
    category: 'collision',
    description: 'Fixture collision rule',
    threshold: null,
    unit: 'mm',
    status,
    severity: 'RED',
    appliesTo: { equipmentIds: null, categories: ['dialysis_machine'] },
    parameters: { scope: options.scope ?? 'equipment' },
    source: status === 'verified' ? { ...VERIFIED_SOURCE } : { ...DRAFT_SOURCE },
  };
}

export function fixtureRuleSet(records: readonly Record<string, unknown>[]): RuleSet {
  return createRuleSet(
    records.map((raw, index) => ({ fileName: `fixture_rule_${index}.json`, raw })),
    { id: 'fixture', version: '0.0.1' },
  );
}

/** Place a fixture machine, with an id derived from its index for determinism. */
export function fixturePlacement(
  index: number,
  position: Vec2,
  equipmentId = 'fixture_machine',
  rotation = 0,
): Placement {
  return {
    id: `placement-${index}`,
    equipmentObjectId: equipmentId,
    equipmentObjectVersion: '0.1.0',
    transform: { position, rotation, mirrored: false },
    label: `FX ${index}`,
    spaceId: null,
  };
}

/** A rectangular boundary in model millimetres. */
export function fixtureBoundary(
  id: string,
  kind: BoundaryKind,
  origin: Vec2,
  width: number,
  height: number,
  label = '',
): Boundary {
  return {
    id,
    kind,
    vertices: [
      { x: origin.x, y: origin.y },
      { x: origin.x + width, y: origin.y },
      { x: origin.x + width, y: origin.y + height },
      { x: origin.x, y: origin.y + height },
    ],
    label,
    // The schema requires a type on an obstruction and refuses one anywhere else.
    obstructionType: kind === 'obstruction' ? 'column' : null,
  };
}

/**
 * An L-shaped room — the geometry the separating axis test gets wrong.
 *
 * ```
 *  (0,0) ───────────────── (12000,0)
 *    │                          │
 *    │                    (12000,4000)
 *    │        ┌─────────────────┘
 *    │        │  ← outside the room, inside its convex hull
 * (0,9000) (6000,9000)
 * ```
 */
export function fixtureLShapedRoom(id = 'room-l', label = 'Treatment area'): Boundary {
  return {
    id,
    kind: 'space_outline',
    vertices: [
      { x: 0, y: 0 },
      { x: 12_000, y: 0 },
      { x: 12_000, y: 4_000 },
      { x: 6_000, y: 4_000 },
      { x: 6_000, y: 9_000 },
      { x: 0, y: 9_000 },
    ],
    label,
    obstructionType: null,
  };
}

export { createPlacement };
