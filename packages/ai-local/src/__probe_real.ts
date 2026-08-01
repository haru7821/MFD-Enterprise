import type { ReferencePointSummary } from '@mfd/ai-contract';
import { dialysisScoringModel } from '@mfd/ai-contract/scoring';
import type { Placement } from '@mfd/document-model';
import { catalog as shippedCatalog } from '@mfd/object-library/catalog';
import { fixtureKnowledge, fixtureRoom, fixtureRoomBoundary, fixtureRuleSet } from '../fixtures/index';
import { scoreLayout, type ScoreInput } from './score';

const machine = shippedCatalog.get('vantive_ak98');
if (!machine) throw new Error('no ak98');
console.log('AK98 serviceClearance:', JSON.stringify(machine.serviceClearance));
function placement(id: string, x: number, y: number): Placement {
  return { id, equipmentObjectId: machine!.id, equipmentObjectVersion: machine!.version, label: id,
    transform: { position: { x, y }, rotation: 0, mirrored: false }, spaceId: null };
}
const ALL_POINTS: ReferencePointSummary[] = [
  { id: 'ro', kind: 'ro_supply', position: { x: 0, y: 0 } },
  { id: 'panel', kind: 'electrical_panel', position: { x: 8_000, y: 0 } },
  { id: 'drain', kind: 'drain', position: { x: 0, y: 6_000 } },
  { id: 'entry', kind: 'access_entry', position: { x: 4_000, y: 0 } },
  { id: 'staff', kind: 'staff_base', position: { x: 4_000, y: 6_000 } },
];
function score(overrides: Partial<ScoreInput> = {}) {
  const placements = [placement('a', 1_000, 1_000), placement('b', 4_000, 1_000)];
  return scoreLayout({
    placements, occupants: placements, catalog: shippedCatalog, ruleSet: fixtureRuleSet(),
    boundaries: [fixtureRoomBoundary()], room: fixtureRoom(), obstructions: [],
    referencePoints: ALL_POINTS, object: machine!, planStatus: 'calibrated', pitchPadding: 1_200,
    knowledge: fixtureKnowledge(), scoring: dialysisScoringModel, stationTarget: 2, ...overrides });
}
const show = (n: string, b: ReturnType<typeof score>) => console.log(n, 'coverage=', b.coverage,
  'total=', b.total, '| measured=', b.criteria.map((c) => `${c.criterion}:${c.weight}`).join(','),
  '| unavail=', b.unavailable.map((u) => `${u.criterion}:${u.reasonCode}`).join(','));
show('REAL ALL POINTS', score());
show('REAL NO POINTS ', score({ referencePoints: [] }));
show('REAL 4 POINTS  ', score({ referencePoints: ALL_POINTS.filter((p) => p.kind !== 'staff_base') }));
