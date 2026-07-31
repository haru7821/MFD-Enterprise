import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Containment, collision and clearance are three questions, and they must never borrow each other's
 * answers.
 *
 * > Owner decision, validation programme: *"Keep containment, collision and clearance completely
 * > independent. Containment answers 'Is the equipment inside the room?' Clearance answers 'Can the
 * > equipment be safely operated?' Collision answers 'Does it intersect another object?' These
 * > concepts must never influence each other."*
 *
 * The behavioural half of this is asserted in `boundary.test.ts` — clearance findings are identical
 * whether a room is drawn or not, and containment is answered without consulting a threshold. What
 * that cannot catch is a future evaluator quietly acquiring the ability to see the other's inputs,
 * where the coupling arrives before the behaviour does. So this reads the source.
 *
 * It is the same shape as `boundaries.test.ts` in `@mfd/layout-knowledge`, and for the same reason:
 * an architectural promise that only exists in prose is a promise that will be broken by someone who
 * never read the prose.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function source(name: string): string {
  return readFileSync(join(HERE, `${name}.ts`), 'utf8');
}

describe('the three questions are asked independently', () => {
  it('clearance cannot see the room outlines', () => {
    /*
     * `EvaluationContext` is `{ placements, catalog }`; only `BoundaryEvaluationContext` adds
     * `boundaries`. A clearance evaluator that took the wider context could answer "too close to the
     * wall" — which is a real question, and one for a *wall clearance rule* with a threshold and a
     * document behind it, not for the room outline an engineer happened to trace.
     */
    const clearance = source('clearance');

    expect(clearance).not.toMatch(/BoundaryEvaluationContext/);
    expect(clearance).not.toMatch(/\bboundaries\b/);
    expect(clearance).not.toMatch(/\bBoundary\b/);
  });

  it('collision cannot see the room outlines either', () => {
    // Equipment-to-equipment overlap is about two footprints. A room outline is not an object.
    const collision = source('collision');

    expect(collision).not.toMatch(/BoundaryEvaluationContext/);
    expect(collision).not.toMatch(/\bboundaries\b/);
  });

  it('containment does not consult a clearance threshold', () => {
    /*
     * The direction that would be easiest to slip into: "it is inside the room, but only just, so
     * call it a violation". Whether a machine flush against a wall can be *serviced* is a clearance
     * question — Owner decision A-4 — and answering it inside the containment evaluator would put
     * the same fact in two places, where the two can disagree and only one is cited.
     */
    const boundary = source('boundary');

    expect(boundary).not.toMatch(/resolveClearanceThreshold/);
    expect(boundary).not.toMatch(/ClearanceRule/);
    expect(boundary).not.toMatch(/sideNormals/);
  });

  it('the three evaluators do not import one another', () => {
    // Whatever they share belongs in a module all three can depend on, not in one of the three.
    for (const [name, others] of [
      ['clearance', ['collision', 'boundary']],
      ['collision', ['clearance', 'boundary']],
      ['boundary', ['clearance', 'collision']],
    ] as const) {
      const text = source(name);
      for (const other of others) {
        expect(text, `${name} imports ${other}`).not.toMatch(
          new RegExp(`from '\\.\\/${other}'`),
        );
      }
    }
  });

  it('these checks are looking at the files they think they are', () => {
    /*
     * Without this the four tests above pass just as well against an empty string — a missing file,
     * a renamed module, a moved directory. Each one asserts an *absence*, and an absence is exactly
     * what you get for free when you are reading nothing.
     */
    expect(source('clearance')).toMatch(/export function evaluateClearance/);
    expect(source('collision')).toMatch(/export function evaluateCollision/);
    expect(source('boundary')).toMatch(/export function evaluateBoundaryCollision/);
  });
});
