import { describe, expect, it } from 'vitest';

import { REASON_CODE_LIST, type EvaluationReport, reasonKind } from '@mfd/rule-engine';

import { buildSummary, decideVerdict } from './conclusion';

/**
 * The verdict.
 *
 * This is the suite that decides whether Sprint 5 was worth doing. Everything else in the
 * report can be slightly wrong and still useful; a verdict that says "acceptable" about a
 * page of uncited figures is a document a TS engineer signs and a hospital builds from.
 *
 * So the load-bearing assertion is negative: **no arrangement of draft data reaches
 * `acceptable`.**
 */

interface FindingSpec {
  readonly level: 'GREEN' | 'YELLOW' | 'RED';
  readonly reasonCode: string;
  readonly caveatCode?: string | null;
}

function report(findings: readonly FindingSpec[]): EvaluationReport {
  const counts = { GREEN: 0, YELLOW: 0, RED: 0 };
  for (const finding of findings) counts[finding.level] += 1;

  return {
    ruleSetId: 'fixture',
    ruleSetVersion: '0.0.1',
    results: findings.map((finding, index) => ({
      ruleId: `rule_${index}`,
      category: 'clearance' as const,
      level: finding.level,
      placementIds: ['placement-1'],
      measured: null,
      appliedValue: null,
      thresholdOrigin: 'none' as const,
      unit: 'mm' as const,
      dataStatus: 'draft' as const,
      reasonCode: finding.reasonCode as never,
      reasonParams: {},
      reason: 'fixture',
      caveatCode: (finding.caveatCode ?? null) as never,
      source: {
        document: null,
        revision: null,
        section: null,
        type: 'estimate' as const,
        lastUpdated: '2026-07-30',
      },
    })),
    counts,
    hasDraftInputs: true,
  };
}

function verdictOf(findings: readonly FindingSpec[], options: { equipment?: number; uncalibrated?: number } = {}) {
  return decideVerdict({
    reports: [report(findings)],
    totalEquipment: options.equipment ?? 1,
    uncalibratedLevels: options.uncalibrated ?? 0,
    draftFieldGroups: 0,
  });
}

describe('the verdict', () => {
  it('is not_acceptable when anything is RED', () => {
    expect(verdictOf([{ level: 'RED', reasonCode: 'RC-311' }, { level: 'GREEN', reasonCode: 'RC-102' }])).toBe(
      'not_acceptable',
    );
  });

  it('is acceptable only when every finding is GREEN', () => {
    expect(verdictOf([{ level: 'GREEN', reasonCode: 'RC-102' }])).toBe('acceptable');
  });

  it('is inconclusive when every YELLOW is "nothing was compared"', () => {
    // A page of "requirement unknown" is not a review with concerns. It is a review that
    // could not run, and calling it review_required would let it read as the former.
    expect(
      verdictOf([
        { level: 'YELLOW', reasonCode: 'RC-110' },
        { level: 'YELLOW', reasonCode: 'RC-901' },
      ]),
    ).toBe('inconclusive');
  });

  it('is inconclusive when every YELLOW is a pass downgraded for provenance', () => {
    // The state the shipped data produces: the comparisons ran and passed, and no figure
    // behind them is cited. The drawing is not the problem; the data is.
    expect(
      verdictOf([
        { level: 'YELLOW', reasonCode: 'RC-102' },
        { level: 'YELLOW', reasonCode: 'RC-202' },
        { level: 'YELLOW', reasonCode: 'RC-321', caveatCode: 'RC-911' },
      ]),
    ).toBe('inconclusive');
  });

  it('is review_required when a YELLOW-severity rule was actually violated', () => {
    // The distinction: something about the layout needs looking at, not something about
    // the data.
    expect(
      verdictOf([
        { level: 'YELLOW', reasonCode: 'RC-101' },
        { level: 'YELLOW', reasonCode: 'RC-102' },
      ]),
    ).toBe('review_required');
  });

  it('is inconclusive on an empty drawing', () => {
    // Nothing placed is not a pass. `acceptable` here would be the most misleading output
    // this engine could produce.
    expect(verdictOf([], { equipment: 0 })).toBe('inconclusive');
  });

  it('never reaches acceptable while any finding is YELLOW', () => {
    // The load-bearing assertion, over every code in the catalogue rather than a chosen
    // few: whatever the finding is, a YELLOW cannot produce a pass.
    for (const reasonCode of REASON_CODE_LIST) {
      if (reasonKind(reasonCode) === 'caveat') continue;
      expect(verdictOf([{ level: 'YELLOW', reasonCode }]), reasonCode).not.toBe('acceptable');
    }
  });

  it('never reaches acceptable while anything is RED', () => {
    for (const reasonCode of REASON_CODE_LIST) {
      if (reasonKind(reasonCode) === 'caveat') continue;
      expect(verdictOf([{ level: 'RED', reasonCode }]), reasonCode).toBe('not_acceptable');
    }
  });
});

describe('the summary', () => {
  it('states the grounds behind the verdict', () => {
    const summary = buildSummary({
      reports: [
        report([
          { level: 'RED', reasonCode: 'RC-311' },
          { level: 'YELLOW', reasonCode: 'RC-110' },
          { level: 'YELLOW', reasonCode: 'RC-110' },
        ]),
      ],
      totalEquipment: 3,
      uncalibratedLevels: 1,
      draftFieldGroups: 6,
    });

    expect(summary.red).toBe(1);
    expect(summary.yellow).toBe(2);
    expect(summary.verdict).toBe('not_acceptable');

    // A verdict a reader cannot account for is one they will over-trust or ignore.
    const grounds = new Map(summary.grounds.map((ground) => [ground.label, ground.count]));
    expect(grounds.get('ground_red_findings')).toBe(1);
    expect(grounds.get('ground_yellow_findings')).toBe(2);
    expect(grounds.get('ground_missing_threshold')).toBe(2);
    expect(grounds.get('ground_uncalibrated_levels')).toBe(1);
    expect(grounds.get('ground_draft_groups')).toBe(6);
  });

  it('says so when nothing was placed', () => {
    const summary = buildSummary({
      reports: [report([])],
      totalEquipment: 0,
      uncalibratedLevels: 0,
      draftFieldGroups: 0,
    });

    expect(summary.grounds.some((ground) => ground.label === 'ground_no_equipment')).toBe(true);
  });

  it('counts equipment, not findings', () => {
    // Eight findings about three machines is three machines. Reporting the finding count as
    // "total equipment" would inflate every summary in proportion to how many rules exist.
    const summary = buildSummary({
      reports: [
        report([
          { level: 'YELLOW', reasonCode: 'RC-110' },
          { level: 'YELLOW', reasonCode: 'RC-110' },
          { level: 'YELLOW', reasonCode: 'RC-110' },
          { level: 'YELLOW', reasonCode: 'RC-110' },
        ]),
      ],
      totalEquipment: 3,
      uncalibratedLevels: 0,
      draftFieldGroups: 0,
    });

    expect(summary.totalEquipment).toBe(3);
  });
});
