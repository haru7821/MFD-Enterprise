import { describe, expect, it } from 'vitest';

import {
  fixtureScoreBreakdown,
  fixtureScoringModel,
} from '../fixtures';
import { scoreBreakdownSchema, scoringModelSchema } from './schema';
import {
  SCORING_CONSTRAINTS,
  SCORING_CRITERIA,
  effectiveWeight,
  normaliseCriterion,
} from './scoring';

describe('the approved scoring model', () => {
  it('accepts the weights the owner approved in B-5a', () => {
    expect(scoringModelSchema.safeParse(fixtureScoringModel).success).toBe(true);
  });

  it("sums the owner's weighted criteria to 1.00", () => {
    const total = Object.values(fixtureScoringModel.criteria).reduce(
      (sum, config) => sum + config.weight,
      0,
    );
    expect(total).toBeCloseTo(1, 10);
  });

  it('gives drain_routing a weight of zero and marks it measured-only', () => {
    // Named in the owner's criterion list, absent from the approved weight table. Measured and
    // printed rather than dropped, so it is visible and weightable by a data change.
    const drain = fixtureScoringModel.criteria.drain_routing;
    expect(drain.weight).toBe(0);
    expect(drain.measuredOnly).toBe(true);
    expect(effectiveWeight(drain)).toBe(0);
  });

  it('ignores a weight left on a measured-only criterion', () => {
    // The failure this guards: somebody weights drain_routing in the data file and leaves the flag
    // behind. The flag wins, so influence cannot be granted by half an edit.
    expect(effectiveWeight({ ...fixtureScoringModel.criteria.drain_routing, weight: 0.3 })).toBe(0);
  });

  it('rejects a model missing a criterion', () => {
    const rest = Object.fromEntries(
      Object.entries(fixtureScoringModel.criteria).filter(([key]) => key !== 'compliance_margin'),
    );
    const result = scoringModelSchema.safeParse({ ...fixtureScoringModel, criteria: rest });
    expect(result.success).toBe(false);
  });

  it('rejects a normalisation reference of zero', () => {
    // "A full score is zero millimetres of pipe" is not a statement about two layouts, and it would
    // divide by zero rather than fail anywhere a reader would notice.
    const result = scoringModelSchema.safeParse({
      ...fixtureScoringModel,
      criteria: {
        ...fixtureScoringModel.criteria,
        ro_piping_length: {
          weight: 0.1,
          direction: 'minimise' as const,
          reference: { perStation: 0 },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('refuses station_count as a criterion at any weight', () => {
    // The emptiest-room failure, blocked at the door. Not a stylistic rule: every other criterion
    // improves as machines are removed, so a station-count criterion — even at weight 0 — makes the
    // one-machine layout the highest-scoring one.
    //
    // Enforced by the `z.enum(SCORING_CRITERIA)` key schema, which rejects an unrecognised key.
    // Verified by widening that key to `z.string()`, which makes this test fail — an explicit
    // refinement saying the same thing was deleted after breaking it changed nothing.
    for (const weight of [0, 0.25]) {
      const result = scoringModelSchema.safeParse({
        ...fixtureScoringModel,
        criteria: {
          ...fixtureScoringModel.criteria,
          station_count: { weight, direction: 'maximise' as const, reference: { target: 12 } },
        },
      });
      expect(result.success, `weight ${weight}`).toBe(false);
    }
  });

  it('keeps every constraint out of the criterion list', () => {
    for (const constraint of SCORING_CONSTRAINTS) {
      expect(SCORING_CRITERIA).not.toContain(constraint);
    }
  });
});

describe('normalisation', () => {
  it('scores a maximise criterion as a fraction of its reference', () => {
    expect(normaliseCriterion(0.75, 1, 'maximise')).toBeCloseTo(0.75, 10);
    expect(normaliseCriterion(6, 4, 'maximise')).toBe(1); // clamped, not 1.5
  });

  it('scores a minimise criterion as headroom below its reference', () => {
    expect(normaliseCriterion(2000, 8000, 'minimise')).toBeCloseTo(0.75, 10);
    expect(normaliseCriterion(8000, 8000, 'minimise')).toBe(0);
  });

  it('floors a minimise criterion at zero rather than going negative', () => {
    // A run twice the reference is as bad as one exactly at it. Deliberate: a negative contribution
    // could drag a total below zero and make the 0…1 scale mean nothing.
    expect(normaliseCriterion(24_000, 8000, 'minimise')).toBe(0);
  });

  it('throws rather than dividing by a zero reference', () => {
    expect(() => normaliseCriterion(100, 0, 'minimise')).toThrow(/must be positive/);
  });

  it('throws on a non-finite measurement', () => {
    expect(() => normaliseCriterion(Number.POSITIVE_INFINITY, 8000, 'minimise')).toThrow(/finite/);
  });
});

describe('ScoreBreakdown', () => {
  it('accepts a complete breakdown', () => {
    const result = scoreBreakdownSchema.safeParse(fixtureScoreBreakdown());
    expect(result.success).toBe(true);
  });

  it('rejects a bare total with no criteria', () => {
    // Owner requirement, B-5a: "Never display only a single total score." Held in the schema so a
    // renderer cannot be written that has only the total to show.
    const breakdown = fixtureScoreBreakdown();
    const result = scoreBreakdownSchema.safeParse({
      ...breakdown,
      criteria: [],
      unavailable: SCORING_CRITERIA.map((criterion) => ({ criterion, reasonCode: 'SC-901' })),
      total: 0,
    });
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/per-criterion breakdown/);
  });

  it('rejects a total that does not equal the sum of its contributions', () => {
    const breakdown = fixtureScoreBreakdown();
    const result = scoreBreakdownSchema.safeParse({ ...breakdown, total: breakdown.total + 0.05 });
    expect(result.success).toBe(false);
  });

  it('rejects a criterion that is neither scored nor reported unavailable', () => {
    // The quiet failure: a criterion vanishes from the breakdown and nobody is told that a fifth of
    // the model was not applied.
    const breakdown = fixtureScoreBreakdown();
    const criteria = breakdown.criteria.filter((c) => c.criterion !== 'walking_distance');
    const result = scoreBreakdownSchema.safeParse({
      ...breakdown,
      criteria,
      total: round(criteria.reduce((sum, c) => sum + c.contribution, 0)),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a criterion that is both measured and unavailable', () => {
    const breakdown = fixtureScoreBreakdown();
    const result = scoreBreakdownSchema.safeParse({
      ...breakdown,
      unavailable: [{ criterion: 'walking_distance', reasonCode: 'SC-901' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a measured-only criterion that contributes anything', () => {
    const breakdown = fixtureScoreBreakdown();
    const criteria = breakdown.criteria.map((c) =>
      c.criterion === 'drain_routing' ? { ...c, contribution: 0.05 } : c,
    );
    const result = scoreBreakdownSchema.safeParse({
      ...breakdown,
      criteria,
      total: round(criteria.reduce((sum, c) => sum + c.contribution, 0)),
    });
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/measuredOnly/);
  });

  it('carries station count as a constraint rather than a criterion', () => {
    const breakdown = fixtureScoreBreakdown();
    expect(breakdown.constraints).toHaveLength(1);
    expect(breakdown.constraints[0]?.constraint).toBe('station_count');
    expect(breakdown.criteria.map((c) => String(c.criterion))).not.toContain('station_count');
  });

  it('reports coverage below 1 when reference points are missing', () => {
    // The B-5a consequence worth a test: four weighted criteria need a reference point, which is
    // 40 % of the approved model. A total renormalised over the remaining 60 % reads identically to
    // a complete one, so `coverage` is what tells them apart.
    const needPoints = [
      'installation_feasibility',
      'ro_piping_length',
      'electrical_routing',
      'walking_distance',
      'drain_routing',
    ] as const;

    const complete = fixtureScoreBreakdown();
    const available = complete.criteria.filter(
      (c) => !needPoints.includes(c.criterion as (typeof needPoints)[number]),
    );
    const availableWeight = available.reduce((sum, c) => sum + c.weight, 0);
    const criteria = available.map((c) => ({
      ...c,
      contribution: round((c.normalised * c.weight) / availableWeight),
    }));

    const breakdown = {
      ...complete,
      criteria,
      unavailable: needPoints.map((criterion) => ({ criterion, reasonCode: 'SC-901' as const })),
      total: round(criteria.reduce((sum, c) => sum + c.contribution, 0)),
      coverage: round(availableWeight),
    };

    expect(scoreBreakdownSchema.safeParse(breakdown).success).toBe(true);
    expect(breakdown.coverage).toBeCloseTo(0.6, 10);
    // Renormalised, so the total still reads as a healthy 0.5 — which is exactly why the fraction
    // it covers has to be printed with it.
    expect(breakdown.total).toBeCloseTo(0.5, 10);
  });
});

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
