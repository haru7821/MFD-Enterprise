import { describe, expect, it } from 'vitest';

import { dialysisScoringModel, parseScoringModel } from '../scoring';
import { AI_CAPABILITIES, LLM_CAPABILITIES, requiresLlm } from './client';
import { AI_CONTRACT_VERSION, REFERENCE_POINT_KINDS } from './context';
import { SCORING_CRITERIA } from './scoring';

/**
 * Shape locks, and the tests that tie this contract to the data it loads.
 *
 * A contract nothing asserts about is a contract that widens quietly. These are the properties
 * other packages will be written against.
 */

describe('the shipped scoring model', () => {
  /*
   * The load-bearing test of this package. `standards/scoring/dialysis.json` is the owner's B-5a
   * decision as data, and importing the entry point *is* the assertion that it parses: the module
   * throws at load if it does not, so a malformed model fails when the application starts rather
   * than the first time somebody asks for a proposal for a customer.
   */
  const model = dialysisScoringModel;

  it("carries exactly the weights the owner approved, summing to 1.00", () => {
    expect(model.criteria.compliance_margin.weight).toBe(0.4);
    expect(model.criteria.installation_feasibility.weight).toBe(0.2);
    expect(model.criteria.maintenance_access.weight).toBe(0.15);
    expect(model.criteria.ro_piping_length.weight).toBe(0.1);
    expect(model.criteria.electrical_routing.weight).toBe(0.05);
    expect(model.criteria.future_expansion.weight).toBe(0.05);
    expect(model.criteria.walking_distance.weight).toBe(0.05);

    const total = Object.values(model.criteria).reduce((sum, c) => sum + c.weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('keeps drain routing measured-only and station count out of the criteria', () => {
    expect(model.criteria.drain_routing.weight).toBe(0);
    expect(model.criteria.drain_routing.measuredOnly).toBe(true);
    expect(Object.keys(model.criteria)).not.toContain('station_count');
  });

  it('is a released version rather than a 0.x draft', () => {
    // An approved decision is not a 0.x file, and every ScoreBreakdown names the version that
    // produced it — so a score in a report stays reproducible after the weights are next revised.
    expect(model.version.startsWith('0.')).toBe(false);
  });

  it('names the file when a model is malformed, rather than failing obscurely later', () => {
    // The loader's own test. A model that failed silently would leave the solver ranking against a
    // partial set of criteria, which is the failure the module-load validation exists to prevent.
    expect(() =>
      parseScoringModel('standards/scoring/broken.json', {
        id: 'broken',
        version: '1.0.0',
        criteria: {},
      }),
    ).toThrow(/standards\/scoring\/broken\.json/);
  });
});

describe('contract shape', () => {
  it('is version 1', () => {
    // Bumping this is a deliberate act: a service built against one version must refuse another
    // rather than read the fields it recognises and ignore the rest.
    expect(AI_CONTRACT_VERSION).toBe(1);
  });

  it('names twelve capabilities, five of which need a model', () => {
    expect(AI_CAPABILITIES).toHaveLength(12);
    expect(LLM_CAPABILITIES).toHaveLength(5);
  });

  it('keeps retrieval out of the LLM capabilities', () => {
    // Decision 1's structural consequence: retrieval is a search index, so it is available whenever
    // a corpus is indexed, model or no model. If this ever flips, "six of nine features work
    // offline" stops being true.
    expect(requiresLlm('retrieve_knowledge')).toBe(false);
    expect(requiresLlm('score_layout')).toBe(false);
    expect(requiresLlm('plan_installation')).toBe(false);
    expect(requiresLlm('answer_query')).toBe(true);
  });

  it('offers a reference-point kind for every criterion that measures from one', () => {
    // B-5a added two criteria that measure from a goods entrance and a nurse base. If either kind
    // were missing, the criterion would be permanently `unavailable` with no way for an engineer to
    // fix it — which would look like a data gap and be a contract gap.
    expect(REFERENCE_POINT_KINDS).toContain('access_entry');
    expect(REFERENCE_POINT_KINDS).toContain('staff_base');
    expect(REFERENCE_POINT_KINDS).toContain('ro_supply');
    expect(REFERENCE_POINT_KINDS).toContain('drain');
    expect(REFERENCE_POINT_KINDS).toContain('electrical_panel');
  });

  it('scores eight criteria', () => {
    expect(SCORING_CRITERIA).toHaveLength(8);
  });
});
