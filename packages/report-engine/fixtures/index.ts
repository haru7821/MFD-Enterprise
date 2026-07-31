import {
  type Boundary,
  type MfdDocument,
  createBoundary,
  createDocument,
  createObstruction,
  createPlacement,
  createSpace,
} from '@mfd/document-model';
import {
  FIELD_GROUP_ORIGIN,
  type Catalog,
  type VerifiedFieldGroup,
  createCatalog,
} from '@mfd/object-library';
import { type RuleSet, createRuleSet } from '@mfd/rule-engine';

import { type ChecklistTemplate, parseChecklistTemplate } from '../src/checklistTemplate';

/**
 * Report fixtures.
 *
 * Two documents, and the second is the more important one:
 *
 * | Fixture | What it exercises |
 * | --- | --- |
 * | `populatedDocument()` | Two levels, rooms, an obstruction, four machines, a calibrated plan and an uncalibrated one |
 * | `emptyDocument()` | A project with nothing placed |
 *
 * The empty one is not an edge case to be tolerated. It is the case where a report engine
 * is most likely to produce something that *looks* finished — no findings, no problems, a
 * clean summary — and it must come out `inconclusive` with the liability notice on the last
 * page. A report on an empty drawing has established nothing.
 *
 * These fixtures carry **invented** figures, the same discipline as the rule engine's: a
 * 1,200 mm here must never look like a manual value, so every source type is `estimate`
 * unless a test is specifically about a verified group.
 */

const DRAFT_SOURCE = {
  document: null,
  revision: null,
  section: null,
  type: 'estimate',
  lastUpdated: '2026-07-30',
} as const;

const VERIFIED_SOURCE = {
  document: 'Fixture Equipment Manual',
  revision: 'Rev. 2',
  section: '4.1 Dimensions',
  type: 'manufacturer_manual',
  lastUpdated: '2026-07-31',
} as const;

/**
 * A cited **installation** source.
 *
 * Separate from {@link VERIFIED_SOURCE} because it has to be: after the owner's AK98 source
 * clarification an installation group cannot cite `manufacturer_manual` at all — the schema has no
 * such member for that side. These fixtures used one verified source for every group, and the
 * change turned that into a validation failure, which is the enforcement working on the first
 * record it met.
 */
const VERIFIED_INSTALLATION_SOURCE = {
  document: 'Fixture TS Installation Standard',
  revision: 'Rev. 1',
  section: '2.3 Station clearances',
  type: 'ts_installation_standard',
  lastUpdated: '2026-07-31',
} as const;

function draftGroup(): Record<string, unknown> {
  return { status: 'draft', source: { ...DRAFT_SOURCE } };
}

function verifiedGroup(): Record<string, unknown> {
  return { status: 'verified', source: { ...VERIFIED_SOURCE } };
}

function verifiedInstallationGroup(): Record<string, unknown> {
  return { status: 'verified', source: { ...VERIFIED_INSTALLATION_SOURCE } };
}

export interface FixtureEquipmentOptions {
  readonly id?: string;
  readonly model?: string;
  readonly manufacturer?: string | null;
  readonly width?: number;
  readonly depth?: number;
  /** Which field groups are cited. Everything not listed stays draft. */
  readonly verifiedGroups?: readonly VerifiedFieldGroup[];
  readonly manufacturerDimensions?: {
    width: number | null;
    depth: number | null;
    height: number | null;
    weight: number | null;
  };
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
  const verified = new Set<VerifiedFieldGroup>(options.verifiedGroups ?? []);
  /*
   * Which citation a group gets is decided by which *side* it is on, not by the caller. A fixture
   * that could hand a manufacturer manual to a service clearance would be modelling a record the
   * schema now refuses, and the tests built on it would be describing a product that cannot exist.
   */
  const group = (name: VerifiedFieldGroup) =>
    !verified.has(name)
      ? draftGroup()
      : FIELD_GROUP_ORIGIN[name] === 'installation'
        ? verifiedInstallationGroup()
        : verifiedGroup();

  return {
    id: options.id ?? 'fixture_machine',
    manufacturer: options.manufacturer === undefined ? 'Fixture Co' : options.manufacturer,
    model: options.model ?? 'FX-1',
    category: 'dialysis_machine',
    version: '1.0.0',
    manufacturerDimensions: {
      ...(options.manufacturerDimensions ?? {
        width: 585,
        depth: 620,
        height: 1_305,
        weight: null,
      }),
      verification: group('manufacturerDimensions'),
    },
    planningFootprint: {
      width: options.width ?? 800,
      depth: options.depth ?? 800,
      basis: 'Fixture planning allowance',
    },
    connections: {
      power: {
        required: true,
        specification: verified.has('power') ? { voltage: '230 V', phase: 1 } : null,
        verification: group('power'),
      },
      roWater: {
        required: true,
        specification: null,
        verification: group('roWater'),
      },
      drain: { required: true, specification: null, verification: group('drain') },
    },
    environmental: {
      specification: verified.has('environmental') ? { temperature: '18–30 °C' } : null,
      verification: group('environmental'),
    },
    serviceClearance: {
      ...(options.serviceClearance ?? { front: 1_200, rear: 800, left: 400, right: 400 }),
      verification: group('serviceClearance'),
    },
    maintenanceAccess: {
      front: null,
      rear: null,
      left: null,
      right: null,
      verification: group('maintenanceAccess'),
    },
    portLocations: {
      power: null,
      roWater: null,
      drain: null,
      verification: group('portLocations'),
    },
    installationRouting: { specification: null, verification: group('installationRouting') },
    symbol: { origin: 'front-left', outline: 'rectangle', frontEdge: 'south' },
  };
}

export function fixtureCatalog(
  records: readonly Record<string, unknown>[] = [fixtureEquipmentRecord()],
): Catalog {
  return createCatalog(
    records.map((raw, index) => ({ fileName: `fixture_equipment_${index}.json`, raw })),
  );
}

export function fixtureClearanceRule(
  options: {
    ruleId?: string;
    side?: 'front' | 'rear' | 'left' | 'right';
    threshold?: number | null;
    status?: 'draft' | 'verified';
    severity?: 'RED' | 'YELLOW';
  } = {},
): Record<string, unknown> {
  const status = options.status ?? 'draft';
  return {
    ruleId: options.ruleId ?? 'fixture_front_clearance',
    category: 'clearance',
    name: { ko: '테스트 정비 공간', en: 'Fixture Service Clearance' },
    description: { ko: '테스트용 정비 공간 규정', en: 'Fixture clearance rule' },
    threshold: options.threshold === undefined ? 1_200 : options.threshold,
    unit: 'mm',
    status,
    severity: options.severity ?? 'RED',
    appliesTo: { equipmentIds: null, categories: ['dialysis_machine'] },
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
    name: { ko: '테스트 간섭', en: 'Fixture Overlap' },
    description: { ko: '테스트용 간섭 규정', en: 'Fixture collision rule' },
    threshold: null,
    unit: 'mm',
    status,
    severity: 'RED',
    appliesTo: { equipmentIds: null, categories: ['dialysis_machine'] },
    parameters: { scope: options.scope ?? 'equipment' },
    source: status === 'verified' ? { ...VERIFIED_SOURCE } : { ...DRAFT_SOURCE },
  };
}

/**
 * The default set governs clearance, equipment overlap **and** boundaries.
 *
 * The boundary rule is not optional here: `populatedDocument` puts Station 3 on top of a
 * column, and without a boundary rule that machine produces no finding at all — the fixture
 * would claim a RED it cannot generate, and every test about severity ordering, the
 * checklist's derived items and the `not_acceptable` verdict would be asserting on a report
 * with nothing wrong in it.
 */
export function fixtureRuleSet(
  records: readonly Record<string, unknown>[] = [
    fixtureClearanceRule(),
    fixtureCollisionRule(),
    fixtureCollisionRule({ ruleId: 'fixture_boundary', scope: 'boundary' }),
  ],
): RuleSet {
  return createRuleSet(
    records.map((raw, index) => ({ fileName: `fixture_rule_${index}.json`, raw })),
    { id: 'fixture', version: '0.0.1' },
  );
}

const TIMESTAMP = '2026-07-30T00:00:00.000Z';

function planImage() {
  return {
    sourceFormat: 'pdf' as const,
    sourceFileName: 'ward-4f.pdf',
    pageIndex: 0,
    pixelWidth: 2_000,
    pixelHeight: 1_400,
    // One transparent pixel. Big enough to be a data URL, small enough that a fixture
    // does not carry a floor plan around in the repository.
    dataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    // A PDF we rendered, so the resolution is known and the printed-scale route is available.
    renderDpi: 150,
    importedAt: TIMESTAMP,
  };
}

function coordinateMapping() {
  return {
    millimetresPerPixel: 10,
    origin: { x: 100, y: 100 },
    rotation: 0,
    calibration: {
      method: 'two-point' as const,
      pointA: { x: 100, y: 100 },
      pointB: { x: 200, y: 100 },
      knownDistance: 1_000,
      statedRatio: null,
      dotsPerInch: null,
      calibratedAt: TIMESTAMP,
    },
    mappedAt: TIMESTAMP,
  };
}

const ROOM: Boundary = {
  ...createBoundary('boundary-room', 'space_outline', [
    { x: 0, y: 0 },
    { x: 8_000, y: 0 },
    { x: 8_000, y: 6_000 },
    { x: 0, y: 6_000 },
  ]),
  label: 'Treatment area A',
};

const COLUMN: Boundary = {
  ...createObstruction('boundary-column', 'column', [
    { x: 3_000, y: 2_500 },
    { x: 3_600, y: 2_500 },
    { x: 3_600, y: 3_100 },
    { x: 3_000, y: 3_100 },
  ]),
  label: 'Column C4',
};

/**
 * A two-level project with everything a report has to describe.
 *
 * Level 1 is calibrated, holds a room, a column and three machines — one of which overlaps
 * the column, so the report has a RED to carry. Level 2 has an imported plan and **no
 * calibration**, which is the state the report must never present as ordinary.
 */
export function populatedDocument(
  catalog: Catalog = fixtureCatalog(),
  renderMode: 'vector' | 'vector_raster' | 'raster' = 'vector',
): MfdDocument {
  const base = createDocument({
    projectId: 'project-fixture',
    name: '4F Dialysis Unit Refurbishment',
    reviewedBy: 'A. Engineer',
    ruleSetRef: { id: 'fixture', version: '0.0.1' },
    now: TIMESTAMP,
    levelId: 'level-4f',
    levelName: '4F',
  });

  const machine = catalog.require('fixture_machine');
  const first = base.project.levels[0];
  if (!first) throw new Error('createDocument produced no level');

  const level4f = {
    ...first,
    planImage: planImage(),
    coordinateMapping: coordinateMapping(),
    boundaries: [ROOM, COLUMN],
    spaces: [
      createSpace('space-a', 'boundary-room', 'Treatment area A', 'hemodialysis_treatment'),
    ],
    placements: [
      createPlacement('placement-1', machine, { x: 500, y: 500 }, {
        label: 'Station 1',
        spaceId: 'space-a',
      }),
      createPlacement('placement-2', machine, { x: 1_500, y: 500 }, {
        label: 'Station 2',
        spaceId: 'space-a',
      }),
      // Standing on the column: the report needs a RED to carry.
      createPlacement('placement-3', machine, { x: 3_200, y: 2_700 }, {
        label: 'Station 3',
        spaceId: 'space-a',
      }),
    ],
    /*
     * Two of the seven kinds, deliberately not all of them.
     *
     * A fixture carrying every kind would let a report that silently dropped one still pass. Two
     * also makes the *partial* case the default one under test: four scoring criteria need a
     * point, and a level with some but not all of them is the state a real project spends most of
     * its life in.
     */
    referencePoints: [
      { id: 'ref-drain', kind: 'drain' as const, position: { x: 200, y: 2_800 }, label: null },
      {
        id: 'ref-panel',
        kind: 'electrical_panel' as const,
        position: { x: 4_400, y: 300 },
        label: 'DB-4F-2',
      },
    ],
  };

  const level5f = {
    id: 'level-5f',
    name: '5F',
    elevation: 3_600,
    planImage: planImage(),
    // Imported and never calibrated — deliberately.
    coordinateMapping: null,
    boundaries: [],
    spaces: [],
    placements: [
      createPlacement('placement-4', machine, { x: 1_000, y: 1_000 }, { label: 'Station 4' }),
    ],
    // None recorded — the other state the report has to state rather than omit.
    referencePoints: [],
  };

  return {
    ...base,
    project: {
      ...base.project,
      // Korean customer details on purpose: the cover page has to carry a name as typed,
      // in a report whose labels are bilingual. A fixture with only Latin names would let
      // a broken font or a mangled encoding pass every test.
      customer: {
        hospital: '서울 하늘병원',
        site: '본관 4층',
        contact: '김민수 시설팀장',
      },
      settings: { reportRenderMode: renderMode },
      levels: [level4f, level5f],
    },
  };
}

/** A project with one level, no plan, no rooms and nothing placed. */
export function emptyDocument(): MfdDocument {
  return createDocument({
    projectId: 'project-empty',
    name: 'Untitled survey',
    ruleSetRef: { id: 'fixture', version: '0.0.1' },
    now: TIMESTAMP,
    levelId: 'level-1',
    levelName: 'Level 1',
  });
}

/** A minimal two-category template, so checklist tests do not depend on the shipped one. */
export function fixtureChecklistTemplate(): ChecklistTemplate {
  return parseChecklistTemplate('fixture_checklist.json', {
    id: 'fixture_checklist',
    version: '0.0.1',
    categories: [
      {
        id: 'electrical',
        title: { ko: '전기', en: 'Electrical' },
        items: [{ id: 'supply', text: { ko: '전원 용량 확인', en: 'Confirm supply capacity' } }],
      },
      {
        id: 'accessibility',
        title: { ko: '접근성', en: 'Accessibility' },
        items: [{ id: 'route', text: { ko: '이동 경로 확인', en: 'Confirm access route' } }],
      },
      {
        id: 'final_engineer_check',
        title: { ko: '최종 엔지니어 확인', en: 'Final Engineer Check' },
        items: [{ id: 'sign_off', text: { ko: '서명', en: 'Sign off' } }],
      },
    ],
  });
}

export const FIXTURE_GENERATED_AT = '2026-07-30T09:15:00.000Z';
export const FIXTURE_MFD_VERSION = '0.5.0-test';
