import { describe, expect, it } from 'vitest';

import { countFacilities, countPlans, resolveFacility, resolvePlan } from './identity';

/**
 * The rule under test: **aggregation identity is never derived from the drawing identity, and never
 * inferred from a filename.**
 *
 * These cases exist because the failure is invisible. A facility grouping computed by parsing an id
 * produces the same shape of answer as one read from a recorded field — right up to the moment the
 * id stops carrying that structure, at which point every drawing becomes its own facility and the
 * count silently inflates.
 */
describe('facility identity is recorded, never derived', () => {
  it('returns a recorded facility with its source', () => {
    expect(
      resolveFacility({ facilityId: 'Hospital_044', facilitySource: 'dataset-metadata' }),
    ).toEqual({ id: 'Hospital_044', source: 'dataset-metadata' });
  });

  it('abstains when no facility was recorded', () => {
    expect(resolveFacility({})).toBeNull();
    expect(resolveFacility({ facilityId: null, facilitySource: null })).toBeNull();
  });

  it('abstains on an id with no source — both or neither', () => {
    /*
     * An id without a source is a value somebody put there, not a declared fact. Accepting it would
     * let an inferred grouping enter through the one door built to keep it out.
     */
    expect(resolveFacility({ facilityId: 'Hospital_044' })).toBeNull();
    expect(resolveFacility({ facilityId: 'Hospital_044', facilitySource: null })).toBeNull();
  });

  it('cannot see a drawingId at all', () => {
    /*
     * The structural guarantee, asserted rather than trusted: a record carrying a path-shaped id and
     * nothing else resolves to null. If `resolveFacility` ever grew a fallback that parsed the id,
     * this is the case that would go green→red.
     */
    const looksLikeItShouldWork = {
      drawingId: 'Hospital_044/dialysis.pdf',
      sha256: 'a'.repeat(64),
    } as Record<string, unknown>;

    expect(resolveFacility(looksLikeItShouldWork)).toBeNull();
  });

  it('does not treat an empty string as a recorded identity', () => {
    expect(resolveFacility({ facilityId: '', facilitySource: 'dataset-metadata' })).toBeNull();
  });
});

describe('plan identity is recorded, never derived', () => {
  it('groups two exports of one plan when both record the same planId', () => {
    const dwg = { planId: 'plan-24bed-a', planSource: 'human-recorded' as const };
    const pdf = { planId: 'plan-24bed-a', planSource: 'human-recorded' as const };

    expect(countPlans([dwg, pdf])).toEqual({ plans: 1, unknown: 0 });
  });

  it('abstains rather than stripping a file extension', () => {
    // What `planOf` used to do: 'Hospital_023/dialysis_24bed.dwg' → 'Hospital_023/dialysis_24bed'.
    expect(resolvePlan({ drawingId: 'Hospital_023/dialysis_24bed.dwg' } as never)).toBeNull();
  });
});

describe('counts report what could not be placed, separately', () => {
  it('does not count unknowns as their own facility', () => {
    /*
     * The inflation this whole decision exists to prevent. Three unplaced records are ONE unknown
     * to report, not three facilities — and reporting them as facilities is exactly how support
     * claimed 117 files of evidence over 24 sites.
     */
    const records = [
      { facilityId: 'Hospital_044', facilitySource: 'dataset-metadata' as const },
      {},
      {},
      {},
    ];

    expect(countFacilities(records)).toEqual({ facilities: 1, unknown: 3 });
  });

  it('counts one facility once however many drawings it has', () => {
    const from = (n: number) =>
      Array.from({ length: n }, () => ({
        facilityId: 'Hospital_001',
        facilitySource: 'dataset-metadata' as const,
      }));

    expect(countFacilities(from(8))).toEqual({ facilities: 1, unknown: 0 });
  });

  it('reports plans and unknowns separately too', () => {
    const records = [
      { planId: 'p1', planSource: 'human-recorded' as const },
      { planId: 'p1', planSource: 'human-recorded' as const },
      {},
    ];

    expect(countPlans(records)).toEqual({ plans: 2 - 1, unknown: 1 });
  });

  it('is empty rather than wrong on an empty corpus', () => {
    expect(countFacilities([])).toEqual({ facilities: 0, unknown: 0 });
    expect(countPlans([])).toEqual({ plans: 0, unknown: 0 });
  });
});
