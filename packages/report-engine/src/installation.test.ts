import { describe, expect, it } from 'vitest';

import { deterministicPlanner } from '@mfd/ai-planner';
import { dialysisSequenceSet } from '@mfd/ai-planner/sequences';

import { dialysisChecklistTemplate } from '../checklists/index';
import { buildInstallation } from './installation';
import { renderHtml } from './render/html';
import { fixturePlanInput } from '../fixtures/planner';
import type { ReportModel } from './model';

/**
 * The installation section, and the property the owner's § 9 turns on.
 *
 * > *"Planner output must automatically feed PDF, BOM, Installation Plan, Commissioning Checklist
 * > without duplicate implementations."*
 *
 * "Without duplicate implementations" is a testable claim, and these are the tests of it: the
 * section computes nothing the planner already decided, and it restates no text another section
 * already owns.
 */

const plan = () => deterministicPlanner(dialysisSequenceSet).plan(fixturePlanInput());

function section() {
  return buildInstallation({
    plan: plan(),
    checklistTemplate: dialysisChecklistTemplate,
    placementNumbers: new Map([
      ['station_1', 1],
      ['station_2', 2],
      ['station_3', 3],
    ]),
  });
}

describe('the section carries what the planner decided, and decides nothing', () => {
  it('keeps the planner’s stage order and dependencies', () => {
    const built = section();
    const source = plan();
    expect(built.stages.map((stage) => stage.id)).toEqual(source.stages.map((stage) => stage.id));
    expect(built.stages.map((stage) => stage.order)).toEqual(
      source.stages.map((stage) => stage.order),
    );
  });

  it('resolves placement ids to the numbers the drawing prints', () => {
    /*
     * The one lookup this file exists for. A plan saying "station 4" beside a floor plan labelling
     * it 7 is worse than a plan with no numbers, and the numbering belongs to the floor plan.
     */
    const stage = section().stages.find((entry) => entry.id === 'equipment_set');
    expect(stage?.placementNumbers).toEqual([1, 2, 3]);
  });

  it('shows no numbers rather than the wrong ones when the level is gone', () => {
    const built = buildInstallation({
      plan: plan(),
      checklistTemplate: dialysisChecklistTemplate,
      placementNumbers: new Map(),
    });
    for (const stage of built.stages) {
      expect(stage.placementNumbers).toEqual([]);
    }
  });
});

describe('one source, two views', () => {
  it('takes the checklist text from the report’s own template', () => {
    /*
     * The planner names ids; the text comes from the checklist the report already prints. A planner
     * with its own commissioning wording would give an engineer two lists that can disagree, and
     * the one they followed on site would be the one that is not in the signed report.
     */
    const stage = section().stages.find((entry) => entry.id === 'ro_pressure_test');
    const check = stage?.checks.find((entry) => entry.id === 'loop_pressure');

    expect(check?.text?.en).toContain('loop pressure');
    // And it is the template's string, not a copy: changing the template changes this.
    const template = dialysisChecklistTemplate;
    const item = template.categories
      .flatMap((category) => category.items)
      .find((entry) => entry.id === 'loop_pressure');
    expect(check?.text).toEqual(item?.text);
  });

  it('marks an unresolvable check rather than dropping it', () => {
    // A null here means the report was built with a different checklist than the plan was, which a
    // reader should see as an unresolved reference rather than as an absence.
    const source = plan();
    const withStranger = {
      ...source,
      stages: source.stages.map((stage) =>
        stage.id === 'handover'
          ? { ...stage, checklistItemIds: [...stage.checklistItemIds, 'not_in_template'] }
          : stage,
      ),
    };
    const built = buildInstallation({
      plan: withStranger,
      checklistTemplate: dialysisChecklistTemplate,
      placementNumbers: new Map(),
    });
    const stage = built.stages.find((entry) => entry.id === 'handover');

    expect(stage?.checks.map((check) => check.id)).toContain('not_in_template');
    expect(stage?.checks.find((check) => check.id === 'not_in_template')?.text).toBeNull();
  });

  it('never restates a finding’s prose', () => {
    /*
     * A risk that came from a finding carries the reason code and no sentence. The rule engine
     * composes that sentence bilingually and the validation section prints it; a second wording
     * here would be the one nobody maintains.
     */
    const built = buildInstallation({
      plan: {
        ...plan(),
        risks: [
          {
            id: 'finding:RC-110',
            origin: 'data_gap',
            ref: 'RC-110',
            title: { ko: '확인 필요 항목', en: 'Requires Review' },
            detail: {
              value: null,
              status: 'unknown',
              source: { kind: 'not_supplied', ref: 'finding:RC-110', citation: null },
            },
            stageId: null,
          },
        ],
      },
      checklistTemplate: dialysisChecklistTemplate,
      placementNumbers: new Map(),
    });

    expect(built.risks[0]?.detail).toBeNull();
    expect(built.risks[0]?.ref).toBe('RC-110');
  });
});

describe('B-7 — the report says what is missing, in the owner’s words', () => {
  it('carries a null value rather than a zero', () => {
    // "Unknown values remain Unknown", at the model boundary. A zero here would print as a real
    // figure, and nothing downstream could tell the difference.
    const built = section();
    expect(built.ratesAvailable).toBe(false);
    expect(built.duration.value).toBeNull();
    expect(built.duration.status).toBe('unknown');
    expect(built.manpower.minimum).toBeNull();
    expect(built.manpower.recommended).toBeNull();
  });

  it('prints the sentence the decision names, instead of the figures', () => {
    /*
     * > *"The report must explicitly state 'Planning rate data not available.' instead of
     * > displaying calculated numbers."*
     *
     * Verbatim in English, because a report that paraphrased it would be a different document from
     * the one that was approved.
     */
    const html = renderHtml(modelWith(section()));
    expect(html).toContain('data-testid="planning-rates-unavailable"');
    expect(html).toContain('Planning rate data not available.');
    expect(html).toContain('설치 기준 산정 자료가 없습니다.');
  });

  it('carries the arithmetic behind a calculated figure', () => {
    // A signed document should let somebody check a sum rather than take it.
    const ro = section().connections.find((entry) => entry.service === 'ro_water');
    expect(ro?.total.status).toBe('calculated');
    expect(ro?.total.calculation?.inputs.length).toBe(3);
    expect(ro?.total.calculation?.formula).toBe('Σ run lengths');
  });
});

describe('the report without a plan', () => {
  it('says so rather than omitting the section', () => {
    /*
     * A report with no installation section would leave a reader unable to tell a project nobody
     * has planned from a build of the software that cannot plan — and only the first is something
     * they can go and fix.
     */
    const html = renderHtml(modelWith(null));
    expect(html).toContain('data-testid="report-installation"');
    expect(html).toContain('No installation plan was generated');
  });
});

/** The smallest report model that renders — everything empty except the section under test. */
function modelWith(installation: ReportModel['installation']): ReportModel {
  return {
    reportVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    renderMode: 'vector',
    cover: {
      hospital: '',
      site: '',
      contact: '',
      projectName: 'Test',
      customerContact: '',
      tsEngineer: '',
      date: '2026-01-01',
      mfdVersion: '0.0.0',
    },
    summary: {
      totalEquipment: 0,
      green: 0,
      yellow: 0,
      red: 0,
      verdict: 'inconclusive',
      grounds: [],
      hasDraftInputs: false,
      evidence: { missingReferences: 0, missingManufacturerCitations: 0, draftRuleCount: 0 },
    },
    equipmentSchedule: { rows: [], unknownEquipmentIds: [] },
    floorPlans: [],
    validation: [],
    checklist: { categories: [] },
    installation,
    datasheets: [],
    standards: { rules: [], ruleSetId: 'dialysis', ruleSetVersion: '0.1.0' },
    notice: { liability: { ko: '.', en: '.' }, caveats: [] },
    provenance: {
      reportVersion: 1,
      documentVersion: 4,
      evaluationResultVersion: 2,
      ruleSetId: 'dialysis',
      ruleSetVersion: '0.1.0',
      catalogueVersions: [],
      mfdVersion: '0.0.0',
      generatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}
