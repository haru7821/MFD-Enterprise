import { describe, expect, it } from 'vitest';

import {
  equipmentLibraryRevisionOf,
  layoutRevisionOf,
  planStaleness,
  ruleSetRevisionOf,
} from './fingerprint';

/**
 * Plan staleness — Hardening decision 1.
 *
 * > *"An installation plan must never appear valid after the layout changes … When any dependency
 * > changes: mark plan as stale."*
 *
 * `planStaleness` is the comparison; `layoutRevisionOf` / `equipmentLibraryRevisionOf` /
 * `ruleSetRevisionOf` are what turn a live project into the strings it compares. Each revision
 * function gets its own describe block: what changes it, and — just as load-bearing — what must
 * *not*, because a revision that moves on a no-op edit would nag an engineer into ignoring it.
 */

const BASE = {
  documentRevision: 'doc:1',
  layoutRevision: 'layout:1',
  equipmentLibraryRevision: 'lib:1',
  ruleSetRevision: 'dialysis@0.1.0',
};

describe('planStaleness', () => {
  it('reports nothing when every dependency matches', () => {
    expect(planStaleness(BASE, BASE)).toEqual([]);
  });

  it('names exactly the dependency that moved', () => {
    // Not a boolean. "The layout changed" and "the rule set was updated" call for different things
    // from an engineer, and a bare "outdated" makes them go and find out which.
    expect(planStaleness(BASE, { ...BASE, layoutRevision: 'layout:2' })).toEqual(['layout']);
    expect(planStaleness(BASE, { ...BASE, ruleSetRevision: 'dialysis@0.2.0' })).toEqual([
      'rule_set',
    ]);
  });

  it('names every dependency that moved, in the declared order', () => {
    const current = {
      documentRevision: 'doc:2',
      layoutRevision: 'layout:1',
      equipmentLibraryRevision: 'lib:2',
      ruleSetRevision: 'dialysis@0.1.0',
    };
    expect(planStaleness(BASE, current)).toEqual(['document', 'equipment_library']);
  });

  it('is not fooled by two dependencies changing to values that collide elsewhere', () => {
    // A boundary case for anyone tempted to compare a single concatenated string instead of the
    // four fields separately: 'a'+'bc' and 'ab'+'c' collide under naive joining.
    const a = { ...BASE, layoutRevision: 'a', equipmentLibraryRevision: 'bc' };
    const b = { ...BASE, layoutRevision: 'ab', equipmentLibraryRevision: 'c' };
    expect(planStaleness(a, b)).toEqual(['layout', 'equipment_library']);
  });
});

describe('layoutRevisionOf', () => {
  const placement = (id: string, x: number, y: number, rotation = 0) => ({
    placementId: id,
    equipmentObjectId: 'vantive_ak98',
    position: { x, y },
    rotation,
    spaceId: 'space_1',
  });

  it('is unaffected by storage order', () => {
    // Sorted internally, so re-saving a project — which can reorder an array without changing a
    // single millimetre of the drawing — must not mark every plan resting on it stale.
    const forward = [placement('a', 0, 0), placement('b', 1_000, 0)];
    const reversed = [placement('b', 1_000, 0), placement('a', 0, 0)];
    expect(layoutRevisionOf(forward)).toBe(layoutRevisionOf(reversed));
  });

  it('changes when a placement moves', () => {
    const before = [placement('a', 0, 0)];
    const after = [placement('a', 100, 0)];
    expect(layoutRevisionOf(before)).not.toBe(layoutRevisionOf(after));
  });

  it('changes when a placement rotates', () => {
    const before = [placement('a', 0, 0, 0)];
    const after = [placement('a', 0, 0, 90)];
    expect(layoutRevisionOf(before)).not.toBe(layoutRevisionOf(after));
  });

  it('changes when a machine is added or removed', () => {
    const one = [placement('a', 0, 0)];
    const two = [placement('a', 0, 0), placement('b', 1_000, 0)];
    expect(layoutRevisionOf(one)).not.toBe(layoutRevisionOf(two));
  });

  it('changes when a machine changes room', () => {
    const before = [{ ...placement('a', 0, 0), spaceId: 'space_1' }];
    const after = [{ ...placement('a', 0, 0), spaceId: 'space_2' }];
    expect(layoutRevisionOf(before)).not.toBe(layoutRevisionOf(after));
  });

  it('changes when the equipment kind changes at the same position', () => {
    // Swapping one machine for another without moving it is still a different installation.
    const before = [placement('a', 0, 0)];
    const after = [{ ...placement('a', 0, 0), equipmentObjectId: 'dialysis_bed' }];
    expect(layoutRevisionOf(before)).not.toBe(layoutRevisionOf(after));
  });

  it('is stable for sub-millimetre float drift', () => {
    // The document holds millimetres and the canvas snaps to them, so this cannot happen today —
    // asserted so a future sub-millimetre coordinate cannot make a plan stale over a rounding error.
    const before = [placement('a', 1_000, 1_000)];
    const after = [placement('a', 1_000.0000001, 999.9999999)];
    expect(layoutRevisionOf(before)).toBe(layoutRevisionOf(after));
  });

  it('is deterministic', () => {
    const placements = [placement('a', 0, 0), placement('b', 1_000, 500)];
    expect(layoutRevisionOf(placements)).toBe(layoutRevisionOf(placements));
  });
});

describe('equipmentLibraryRevisionOf', () => {
  it('is unaffected by catalogue order', () => {
    const a = [{ id: 'x', version: '1' }, { id: 'y', version: '1' }];
    const b = [{ id: 'y', version: '1' }, { id: 'x', version: '1' }];
    expect(equipmentLibraryRevisionOf(a)).toBe(equipmentLibraryRevisionOf(b));
  });

  it('changes when a record is re-versioned', () => {
    const before = [{ id: 'vantive_ak98', version: '0.1.0' }];
    const after = [{ id: 'vantive_ak98', version: '0.2.0' }];
    expect(equipmentLibraryRevisionOf(before)).not.toBe(equipmentLibraryRevisionOf(after));
  });

  it('changes when a record is added, even unplaced', () => {
    /*
     * The conservative direction, deliberately: deciding *here* which catalogue changes can affect
     * an existing plan would mean revisiting that judgement every time the planner learned to read
     * a new field. Over-warning costs a regeneration; under-warning costs a wrong bill of materials.
     */
    const before = [{ id: 'vantive_ak98', version: '0.1.0' }];
    const after = [
      { id: 'vantive_ak98', version: '0.1.0' },
      { id: 'dialysis_bed', version: '0.1.0' },
    ];
    expect(equipmentLibraryRevisionOf(before)).not.toBe(equipmentLibraryRevisionOf(after));
  });
});

describe('ruleSetRevisionOf', () => {
  it('changes when the version changes', () => {
    expect(ruleSetRevisionOf({ id: 'dialysis', version: '0.1.0' })).not.toBe(
      ruleSetRevisionOf({ id: 'dialysis', version: '0.2.0' }),
    );
  });

  it('changes when the id changes', () => {
    expect(ruleSetRevisionOf({ id: 'dialysis', version: '0.1.0' })).not.toBe(
      ruleSetRevisionOf({ id: 'icu', version: '0.1.0' }),
    );
  });
});
