import { describe, expect, it } from 'vitest';

import { deterministicPlanner } from '@mfd/ai-planner';
import { dialysisSequenceSet } from '@mfd/ai-planner/sequences';
import { createDocument, createPlacement } from '@mfd/document-model';
import type { MfdDocument } from '@mfd/document-model';
import { catalog } from '@mfd/object-library/catalog';
import { dialysisRuleSet } from '@mfd/rule-engine/rules';

import { dialysisChecklistTemplate } from '../checklists/index';
import { fixturePlanInput } from '../fixtures/planner';
import { buildReport } from './build';
import { projectFingerprint } from './fingerprint';
import { renderHtml } from './render/html';
import { renderJson } from './render/json';

/**
 * Plan staleness, end to end through the report — Hardening decision 1.
 *
 * > *"A stale plan must never produce a signed PDF without warning."*
 *
 * The unit tests one layer down check that `planStaleness` compares correctly and that the section
 * carries what it is given. **This file checks the thing that actually protects a hospital:** that
 * a report built from a document the plan no longer describes says so, in the section and on the
 * liability page, without anybody having to remember to pass a flag.
 *
 * That is why `buildReport` computes the staleness itself rather than accepting it. A caller can
 * pass a wrong boolean; a caller cannot pass a different document than the one being reported on.
 */

const LEVEL_ID = 'level-1';

function project(stations: number): MfdDocument {
  const object = catalog.objects[0];
  if (!object) throw new Error('the catalogue is empty');

  const document = createDocument({
    projectId: 'p',
    name: 'Ward',
    now: '2026-01-01T00:00:00.000Z',
    levelId: LEVEL_ID,
    levelName: 'L1',
    ruleSetRef: { id: 'dialysis', version: '0.1.0' },
  });
  const level = document.project.levels[0];
  if (!level) throw new Error('the document has no level');

  const placements = Array.from({ length: stations }, (_, index) =>
    createPlacement(`p-${index}`, object, { x: index * 2_000, y: 0 }, { label: `AK98 ${index + 1}` }),
  );
  return { ...document, project: { ...document.project, levels: [{ ...level, placements }] } };
}

/** A plan made from a document, fingerprinted against that same document. */
function planFor(document: MfdDocument) {
  const level = document.project.levels[0];
  if (!level) throw new Error('the document has no level');

  return deterministicPlanner(dialysisSequenceSet).plan({
    ...fixturePlanInput(),
    levelId: LEVEL_ID,
    placements: level.placements.map((placement) => ({
      placementId: placement.id,
      equipmentObjectId: placement.equipmentObjectId,
      position: placement.transform.position,
      rotation: placement.transform.rotation,
      spaceId: placement.spaceId,
    })),
    equipment: catalog.objects.map((object) => ({
      id: object.id,
      version: object.version,
      model: object.model,
      dataStatus: 'draft' as const,
      connections: (['power', 'ro_water', 'drain'] as const).map((service) => ({
        service,
        required: true,
        specified: false,
        status: 'draft' as const,
      })),
    })),
    /*
     * Both supplied revisions come from the same `projectFingerprint` the report will compare
     * against — which is exactly what `runPlanner` does in the editor. Supplying one and not the
     * other is how a plan ends up permanently stale, and this fixture made that mistake once.
     */
    ...(() => {
      const current = projectFingerprint(document, LEVEL_ID, catalog, dialysisRuleSet);
      return {
        documentRevision: current.documentRevision,
        equipmentLibraryRevision: current.equipmentLibraryRevision,
      };
    })(),
  });
}

function report(document: MfdDocument, installationPlan: ReturnType<typeof planFor>) {
  return buildReport({
    document,
    catalog,
    ruleSet: dialysisRuleSet,
    checklistTemplate: dialysisChecklistTemplate,
    generatedAt: '2026-02-01T00:00:00.000Z',
    mfdVersion: '0.5.0-test',
    installationPlan,
  });
}

describe('a plan built from the document it is reported with', () => {
  const document = project(3);
  const model = report(document, planFor(document));

  it('is not stale', () => {
    expect(model.installation?.staleness).toEqual([]);
  });

  it('carries no warning in the section', () => {
    expect(renderHtml(model)).not.toContain('data-testid="installation-stale"');
  });

  it('adds no caveat to the liability page', () => {
    expect(model.notice.caveats.map((caveat) => caveat.en).join(' ')).not.toContain(
      'must not be used as a basis for installation',
    );
  });
});

describe('a plan built before the layout moved', () => {
  /*
   * The scenario the decision exists for: an engineer plans, then nudges a machine, then exports.
   * Nothing about the plan changes — it is the same object — and everything about what the report
   * says about it does.
   */
  const before = project(3);
  const plan = planFor(before);
  const after = project(4);
  const model = report(after, plan);

  it('names the layout as the dependency that moved', () => {
    expect(model.installation?.staleness).toContain('layout');
  });

  it('warns at the top of the installation section, in both languages', () => {
    const html = renderHtml(model);
    expect(html).toContain('data-testid="installation-stale"');
    expect(html).toContain('Installation plan is outdated. Regenerate required.');
    expect(html).toContain('설치 계획이 최신 상태가 아닙니다');
    // And names what moved, rather than leaving an engineer to find out.
    expect(html).toContain('data-dependency="layout"');
  });

  it('puts the warning before the first stage, not after it', () => {
    // A reader who stops skimming at the first heading has still been told.
    const html = renderHtml(model);
    expect(html.indexOf('installation-stale')).toBeLessThan(html.indexOf('installation-sequence'));
  });

  it('adds the caveat to the liability page', () => {
    // Where a reader looks to find out what a signed report does *not* stand behind.
    expect(model.notice.caveats.map((caveat) => caveat.en).join(' ')).toContain(
      'must not be used as a basis for installation',
    );
  });

  it('reaches the JSON export too, so no format can drop it', () => {
    /*
     * `json.ts` is three lines — it serialises the model. Asserted anyway, because the property
     * being protected is *"no format prints this plan without the warning"*, and a format that
     * silently omitted a field would break that without breaking anything else.
     */
    const parsed = JSON.parse(renderJson(model)) as typeof model;
    expect(parsed.installation?.staleness).toContain('layout');
  });

  it('still prints the plan, rather than withholding it', () => {
    /*
     * Warned, not suppressed. An engineer with a superseded plan and a deadline needs to see what
     * it said — the previous sequence is a useful starting point, and hiding it would push them
     * into keeping a copy outside the tool, which is worse than a warned copy inside it.
     */
    expect(model.installation?.stages.length).toBeGreaterThan(0);
    expect(renderHtml(model)).toContain('data-testid="installation-sequence"');
  });
});

describe('the other three dependencies', () => {
  const document = project(3);

  it('catches a rule set revision', () => {
    const plan = planFor(document);
    const model = buildReport({
      document,
      catalog,
      ruleSet: { ...dialysisRuleSet, version: '9.9.9' },
      checklistTemplate: dialysisChecklistTemplate,
      generatedAt: '2026-02-01T00:00:00.000Z',
      mfdVersion: '0.5.0-test',
      installationPlan: plan,
    });
    expect(model.installation?.staleness).toContain('rule_set');
  });

  it('catches a reference point moving, through the document revision', () => {
    /*
     * A reference point is not a placement, so `layoutRevision` does not see it — and it is the
     * origin of every connection run in the plan. This is what `documentRevision` is for.
     */
    const plan = planFor(document);
    const level = document.project.levels[0];
    if (!level) throw new Error('no level');

    const withPoint: MfdDocument = {
      ...document,
      project: {
        ...document.project,
        levels: [
          {
            ...level,
            referencePoints: [
              { id: 'point_ro', kind: 'ro_supply', position: { x: 0, y: 0 }, label: null },
            ],
          },
        ],
      },
    };

    expect(report(withPoint, plan).installation?.staleness).toContain('document');
  });

  it('marks a plan for a deleted level stale rather than current', () => {
    // The level is gone, so the fingerprint cannot match anything — and a plan for a floor that no
    // longer exists must never read as describing this project.
    const plan = planFor(document);
    const emptied: MfdDocument = {
      ...document,
      project: {
        ...document.project,
        levels: document.project.levels.map((entry) => ({ ...entry, id: 'level-renamed' })),
      },
    };
    expect(report(emptied, plan).installation?.staleness.length).toBeGreaterThan(0);
  });
});
