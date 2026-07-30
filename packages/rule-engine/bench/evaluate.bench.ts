/**
 * Rule engine performance baseline.
 *
 * Run: `pnpm bench`
 *
 * Measures the engine alone, in Node, with no browser and no React. Rendering
 * cost is measured separately in the browser — see
 * docs/testing/PERFORMANCE_TEST_PLAN.md — because mixing the two produces a
 * number that cannot be acted on: you learn the frame was slow but not which half
 * to fix.
 *
 * The target comes from TS Edition specification section 6: fifty equipment
 * objects. Larger counts are included to find where the O(n²) collision pass
 * stops being free rather than to claim they are supported.
 */

import type { Boundary, Placement } from '@mfd/document-model';
import { createCatalog, type Catalog } from '@mfd/object-library';

import { evaluateBoundaryCollision } from '../src/evaluators/boundary';
import { evaluateCollision } from '../src/evaluators/collision';
import { evaluate, type SpatialContext } from '../src/evaluate';
import { createRuleSet, type RuleSet } from '../src/ruleSet';
import type { CollisionRule } from '../src/schema';

const DRAFT_SOURCE = {
  document: null,
  revision: null,
  section: null,
  type: 'estimate',
  lastUpdated: '2026-07-29',
} as const;

function equipmentRecord(): Record<string, unknown> {
  return {
    id: 'bench_machine',
    manufacturer: 'Bench',
    model: 'BX1',
    category: 'dialysis_machine',
    version: '0.1.0',
    dataStatus: 'draft',
    dimensions: { width: 900, depth: 750, height: null, weight: null },
    connections: {
      power: { required: true, port: null, specification: null },
      roWater: { required: true, port: null, specification: null },
      drain: { required: true, port: null, specification: null },
    },
    // Real figures, so the clearance evaluators do actual work rather than
    // returning "threshold unknown" early. The shipped rule set has nulls; a
    // benchmark of the early-exit path would measure nothing.
    serviceClearance: { front: 1_200, rear: 600, left: 400, right: 400 },
    source: { ...DRAFT_SOURCE },
    symbol: { origin: 'front-left', outline: 'rectangle', frontEdge: 'south' },
  };
}

function clearanceRule(side: string): Record<string, unknown> {
  return {
    ruleId: `bench_${side}_clearance`,
    category: 'clearance',
    description: `Bench ${side} clearance`,
    threshold: null,
    unit: 'mm',
    status: 'draft',
    severity: 'RED',
    appliesTo: { equipmentIds: ['bench_machine'], categories: null },
    parameters: { side },
    source: { ...DRAFT_SOURCE },
  };
}

const COLLISION_RULE: Record<string, unknown> = {
  ruleId: 'bench_overlap',
  category: 'collision',
  description: 'Bench overlap',
  threshold: null,
  unit: 'mm',
  status: 'draft',
  severity: 'RED',
  appliesTo: { equipmentIds: null, categories: ['dialysis_machine'] },
  parameters: { scope: 'equipment' },
  source: { ...DRAFT_SOURCE },
};

const BOUNDARY_RULE: Record<string, unknown> = {
  ruleId: 'bench_boundary',
  category: 'collision',
  description: 'Bench boundary',
  threshold: null,
  unit: 'mm',
  status: 'draft',
  severity: 'RED',
  appliesTo: { equipmentIds: null, categories: ['dialysis_machine'] },
  parameters: { scope: 'boundary' },
  source: { ...DRAFT_SOURCE },
};

/**
 * The building the layout sits in: one L-shaped room around everything, plus a
 * structural column every fourth row.
 *
 * Concave on purpose. A rectangle would let the ray-casting containment test exit
 * on its first edge and flatter the numbers — and a rectangle is the one room shape
 * this evaluator would not have needed ray casting for.
 */
function building(count: number): Boundary[] {
  const perRow = 10;
  const rows = Math.ceil(count / perRow);
  const width = perRow * 1_400 + 2_000;
  const height = rows * 1_900 + 2_000;

  const boundaries: Boundary[] = [
    {
      id: 'room',
      kind: 'space_outline',
      vertices: [
        { x: -1_000, y: -1_000 },
        { x: width, y: -1_000 },
        { x: width, y: height / 2 },
        { x: width - 500, y: height / 2 },
        { x: width - 500, y: height },
        { x: -1_000, y: height },
      ],
      label: 'Bench treatment area',
      obstructionType: null,
    },
  ];

  for (let row = 0; row < rows; row += 4) {
    const x = perRow * 1_400 + 200;
    const y = row * 1_900;
    boundaries.push({
      id: `column-${row}`,
      kind: 'obstruction',
      vertices: [
        { x, y },
        { x: x + 400, y },
        { x: x + 400, y: y + 400 },
        { x, y: y + 400 },
      ],
      label: `Column ${row}`,
      obstructionType: 'column',
    });
  }

  return boundaries;
}

/**
 * A realistic dialysis floor: rows of stations at a spacing that leaves some
 * clearances satisfied and some not, plus a rotated row. A grid with everything
 * comfortably apart would let the gap search exit early and flatter the numbers.
 */
function layout(count: number): Placement[] {
  const placements: Placement[] = [];
  const perRow = 10;

  for (let index = 0; index < count; index += 1) {
    const column = index % perRow;
    const row = Math.floor(index / perRow);
    placements.push({
      id: `placement-${index}`,
      equipmentObjectId: 'bench_machine',
      equipmentObjectVersion: '0.1.0',
      transform: {
        position: { x: column * 1_400, y: row * 1_900 },
        // Every third row turned, so the rotated paths are exercised.
        rotation: row % 3 === 2 ? 30_000 : 0,
        mirrored: false,
      },
      label: `BX ${index}`,
      spaceId: null,
    });
  }

  return placements;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

interface Timing {
  readonly median: number;
  readonly min: number;
  readonly max: number;
}

function time(runs: number, work: () => void): Timing {
  // Warm up so the first measurement is not the JIT compiling.
  for (let i = 0; i < 5; i += 1) work();

  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    work();
    samples.push(performance.now() - start);
  }

  return { median: median(samples), min: Math.min(...samples), max: Math.max(...samples) };
}

function format(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(2)} ms`;
}

const catalog: Catalog = createCatalog([
  { fileName: 'bench.json', raw: equipmentRecord() },
]);

const ruleSet: RuleSet = createRuleSet(
  [
    { fileName: 'bench_rules.json', raw: ['front', 'rear', 'left', 'right'].map(clearanceRule) },
    { fileName: 'bench_collision.json', raw: COLLISION_RULE },
    { fileName: 'bench_boundary.json', raw: BOUNDARY_RULE },
  ],
  { id: 'bench', version: '0.0.1' },
);

const collisionRule = ruleSet.get('bench_overlap') as CollisionRule;
const boundaryRule = ruleSet.get('bench_boundary') as CollisionRule;

console.log('Rule engine baseline — Node, no browser\n');
console.log(
  'objects   full evaluate            equipment collision      boundary collision      results',
);
console.log('─'.repeat(94));

for (const count of [10, 50, 100, 200]) {
  const placements = layout(count);
  const context = { placements, catalog };
  const spatial: SpatialContext = {
    boundaries: building(count),
    planStatus: 'calibrated',
  };
  const boundaryContext = { ...context, boundaries: spatial.boundaries };
  const subjects = placements.flatMap((placement) => {
    const object = catalog.get(placement.equipmentObjectId);
    return object ? [{ placement, object }] : [];
  });

  const runs = count > 100 ? 20 : 50;
  const full = time(runs, () => evaluate({ placements, catalog, ruleSet, spatial }));
  const collision = time(runs, () => evaluateCollision(collisionRule, subjects, context));
  const boundary = time(runs, () =>
    evaluateBoundaryCollision(boundaryRule, subjects, boundaryContext),
  );

  const results = evaluate({ placements, catalog, ruleSet, spatial }).results.length;

  const marker = count === 50 ? ' ← specification target' : '';
  console.log(
    `${String(count).padStart(5)}   ` +
      `${format(full.median).padStart(9)} (${format(full.min)}–${format(full.max)})`.padEnd(25) +
      `${format(collision.median).padStart(9)} (${format(collision.min)}–${format(collision.max)})`.padEnd(24) +
      `${format(boundary.median).padStart(9)} (${format(boundary.min)}–${format(boundary.max)})`.padEnd(24) +
      `${String(results).padStart(6)}${marker}`,
  );
}

console.log(
  '\nFrame budget is 16.7 ms at 60 fps. Evaluation runs on change, not per frame.',
);
