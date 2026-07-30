import { describe, expect, it } from 'vitest';

import {
  fixtureCatalog,
  fixtureClearanceRule,
  fixtureCollisionRule,
  fixtureEquipmentRecord,
  fixturePlacement,
  fixtureRuleSet,
} from '../fixtures/index';
import { evaluate } from './evaluate';
import {
  EVALUATION_RESULT_VERSION,
  LANGUAGES,
  REASON_CODE_LIST,
  RESULT_LEVELS,
  renderReason,
} from './index';

/**
 * Shape lock for the frozen evaluation contract.
 *
 * These tests assert the **exact** key set of a result and a report — not that
 * certain keys exist, but that no others do. An added field fails here.
 *
 * That is the point. Sprint 5's report generator will read this shape, and so
 * will server-side re-evaluation when it has to agree with what the browser
 * showed. A field quietly added in one place and missing in the other is the kind
 * of divergence that surfaces as a report contradicting the screen it came from.
 *
 * To change the contract: change the shape, update the expected keys here, and
 * bump EVALUATION_RESULT_VERSION. All three, deliberately.
 */

const RESULT_KEYS = [
  'appliedValue',
  'category',
  'caveatCode',
  'dataStatus',
  'level',
  'measured',
  'placementIds',
  'reason',
  'reasonCode',
  'reasonParams',
  'ruleId',
  'source',
  'thresholdOrigin',
  'unit',
] as const;

const REPORT_KEYS = [
  'counts',
  'hasDraftInputs',
  'results',
  'ruleSetId',
  'ruleSetVersion',
] as const;

const SOURCE_KEYS = ['document', 'lastUpdated', 'revision', 'section', 'type'] as const;

/** A layout exercising every result path: a violation, a pass and an unknown. */
function report() {
  return evaluate({
    placements: [
      fixturePlacement(1, { x: 0, y: 0 }),
      fixturePlacement(2, { x: 400, y: 0 }),
      fixturePlacement(3, { x: 9_000, y: 9_000 }),
    ],
    catalog: fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'verified' })]),
    ruleSet: fixtureRuleSet([
      fixtureClearanceRule({ ruleId: 'with_threshold', threshold: 1_200, status: 'verified' }),
      fixtureClearanceRule({ ruleId: 'without_threshold', threshold: null }),
      fixtureCollisionRule({ status: 'verified' }),
    ]),
  });
}

describe('the frozen evaluation contract', () => {
  it('is at version 2', () => {
    expect(EVALUATION_RESULT_VERSION).toBe(2);
  });

  it('reports exactly the agreed keys', () => {
    expect(Object.keys(report()).sort()).toEqual([...REPORT_KEYS]);
  });

  it('gives every result exactly the agreed keys', () => {
    const results = report().results;
    expect(results.length).toBeGreaterThan(3);

    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual([...RESULT_KEYS]);
      expect(Object.keys(result.source).sort()).toEqual([...SOURCE_KEYS]);
    }
  });

  it('holds every field to its agreed type', () => {
    for (const result of report().results) {
      expect(typeof result.ruleId).toBe('string');
      expect(['clearance', 'collision']).toContain(result.category);
      expect(RESULT_LEVELS).toContain(result.level);
      expect(Array.isArray(result.placementIds)).toBe(true);
      expect(result.measured === null || typeof result.measured === 'number').toBe(true);
      expect(result.appliedValue === null || typeof result.appliedValue === 'number').toBe(
        true,
      );
      expect(['rule', 'equipment', 'none']).toContain(result.thresholdOrigin);
      expect(result.unit).toBe('mm');
      expect(['draft', 'verified']).toContain(result.dataStatus);
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
      expect(REASON_CODE_LIST).toContain(result.reasonCode);
      expect(result.caveatCode === null || REASON_CODE_LIST.includes(result.caveatCode)).toBe(
        true,
      );
      // Parameter values are the three things a template can interpolate, and nothing
      // else: a number, a name printed verbatim, or a word that differs by language.
      for (const [key, value] of Object.entries(result.reasonParams)) {
        const shape =
          typeof value === 'number' ||
          typeof value === 'string' ||
          (typeof value === 'object' &&
            typeof (value as { ko?: unknown }).ko === 'string' &&
            typeof (value as { en?: unknown }).en === 'string');
        expect(shape, `${result.reasonCode}.${key}`).toBe(true);
      }
    }
  });

  it('renders every finding in both languages, from the code rather than the prose', () => {
    // The bilingual guarantee, asserted where it can actually be broken. A finding whose
    // Korean is missing, or whose Korean still contains an unfilled {placeholder}, fails
    // here rather than reaching a customer's PDF.
    for (const result of report().results) {
      for (const language of LANGUAGES) {
        const rendered = renderReason(language, result.reasonCode, result.reasonParams);
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered, `${result.reasonCode} in ${language}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('derives the English sentence from the code, so the two cannot disagree', () => {
    // `reason` is a convenience for the live panel, not a second source of truth. If it
    // were authored separately it would drift from the Korean the first time a wording
    // changed, and nothing would notice.
    for (const result of report().results) {
      expect(result.reason).toBe(
        renderReason('en', result.reasonCode, result.reasonParams),
      );
    }
  });

  it('counts exactly the three levels, and they sum to the result count', () => {
    const summary = report();

    expect(Object.keys(summary.counts).sort()).toEqual(['GREEN', 'RED', 'YELLOW']);
    const total = summary.counts.GREEN + summary.counts.YELLOW + summary.counts.RED;
    expect(total).toBe(summary.results.length);
  });

  it('serialises to JSON and back without loss', () => {
    // The contract crosses a network boundary in Sprint 5. Anything that does not
    // survive JSON.stringify is not part of it — no Dates, no Maps, no undefined.
    const original = report();
    const roundTripped = JSON.parse(JSON.stringify(original));

    expect(roundTripped).toEqual(original);
  });

  it('carries no undefined values, which JSON would silently drop', () => {
    for (const result of report().results) {
      for (const [key, value] of Object.entries(result)) {
        expect(value, `${result.ruleId}.${key}`).not.toBeUndefined();
      }
    }
  });

  it('orders results worst first', () => {
    const rank = { RED: 0, YELLOW: 1, GREEN: 2 } as const;
    const levels = report().results.map((result) => rank[result.level]);

    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
  });

  it('stamps the rule set that produced it', () => {
    // A finding with no rule set version cannot be reproduced six months later.
    const summary = report();
    expect(summary.ruleSetId).toBe('fixture');
    expect(summary.ruleSetVersion).toBe('0.0.1');
  });
});
