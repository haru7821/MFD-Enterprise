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

/**
 * The file with its comments removed.
 *
 * These assertions are about what the code *does*, and a doc comment explaining why a kind is
 * excluded is not the evaluator reading it. Asserting against raw source made the guard fail on the
 * sentence that explains the guard — which would have pushed the next person to delete the
 * assertion rather than satisfy it.
 */
function code(name: string): string {
  return source(name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('the three questions are asked independently', () => {
  it('clearance never consults the room outline, and never answers containment', () => {
    /*
     * **Narrowed, not weakened** — and it is worth being exact about which.
     *
     * > Owner decision A-4: *"Clearance evaluation remains completely separate from **containment**
     * > evaluation."*
     *
     * This used to ban the words `boundaries` and `Boundary` from the file outright. That is wider
     * than A-4: `wall` and `obstruction` are not containment inputs. `boundary.ts` treats only
     * `space_outline` as a container — the other two kinds it tests for *overlap*, exactly as
     * equipment is tested.
     *
     * The blanket ban had a cost that was being paid live. `@mfd/ai-local`'s `measureMaintenanceAccess`
     * has counted walls and obstructions against a service face since the owner's round-8 decision
     * (`criteria.ts`, via `obstructionBoundaries` — every non-`space_outline` boundary). So the
     * solver scored a candidate with a wall in front of its face while the rule engine reported that
     * same face clear: two subsystems, one question, two answers.
     *
     * Owner decision D3 settled it — *"treat walls as real obstructions"* — and the GM's ruling was
     * that A-4 is narrowed rather than overturned. So the assertions below are about the specific
     * line A-4 draws, and each names why it is there. A guard that asserts more than its decision
     * says is a guard that will one day be deleted wholesale to get past it, which is very nearly
     * what happened here.
     */
    const clearance = code('clearance');

    // 1. The room outline is containment's alone. Clearance must not read it under any name.
    expect(clearance).not.toMatch(/space_outline/);

    // 2. It must not import the containment evaluator or reuse its answer.
    expect(clearance).not.toMatch(/from '\.\/boundary'/);
    expect(clearance).not.toMatch(/evaluateBoundaryCollision/);
    expect(clearance).not.toMatch(/polygonContainsPolygon/);

    // 3. It must not emit a containment finding. RC-3xx is the boundary evaluator's range.
    expect(clearance).not.toMatch(/RC-3\d\d/);

    // 4. And it must still be reading boundaries for the reason D3 gave — the positive assertion,
    //    so this test fails if someone reverts the fix rather than silently passing again.
    expect(clearance).toMatch(/boundary\.kind !== 'wall' && boundary\.kind !== 'obstruction'/);
    // ...and the doc comment must still explain the exclusion, which is where a reader looks first.
    expect(source('clearance')).toMatch(/space_outline/);
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
