import type { ReferencePointSummary } from '@mfd/ai-contract';
import { dialysisScoringModel } from '@mfd/ai-contract/scoring';
import type { Placement } from '@mfd/document-model';
import {
  fixtureCatalog, fixtureKnowledge, fixtureMachine, fixtureRoom, fixtureRoomBoundary, fixtureRuleSet,
} from '../fixtures/index';
import { scoreLayout, type ScoreInput } from './score';

const machine = fixtureMachine();
function placement(id: string, x: number, y: number): Placement {
  return { id, equipmentObjectId: machine.id, equipmentObjectVersion: machine.version, label: id,
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
    placements, occupants: placements, catalog: fixtureCatalog(), ruleSet: fixtureRuleSet(),
    boundaries: [fixtureRoomBoundary()], room: fixtureRoom(), obstructions: [],
    referencePoints: ALL_POINTS, object: machine, planStatus: 'calibrated', pitchPadding: 1_200,
    knowledge: fixtureKnowledge(), scoring: dialysisScoringModel, stationTarget: 2, ...overrides });
}
const show = (n: string, b: ReturnType<typeof score>) => {
  console.log(n, 'coverage=', b.coverage, 'total=', b.total,
    'measured=', b.criteria.map((c) => `${c.criterion}:${c.weight}`).join(','),
    '| unavailable=', b.unavailable.map((u) => `${u.criterion}:${u.reasonCode}`).join(','));
};
show('ALL POINTS ', score());
show('NO POINTS  ', score({ referencePoints: [] }));
show('TWO POINTS ', score({ referencePoints: ALL_POINTS.slice(0, 2) }));
