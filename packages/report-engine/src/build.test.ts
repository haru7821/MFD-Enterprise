import { describe, expect, it } from 'vitest';

import { SECTION_ORDER } from './model';
import { buildReport } from './build';
import {
  FIXTURE_GENERATED_AT,
  FIXTURE_MFD_VERSION,
  emptyDocument,
  fixtureCatalog,
  fixtureChecklistTemplate,
  fixtureRuleSet,
  populatedDocument,
} from '../fixtures/index';

function report(document = populatedDocument()) {
  return buildReport({
    document,
    catalog: fixtureCatalog(),
    ruleSet: fixtureRuleSet(),
    checklistTemplate: fixtureChecklistTemplate(),
    generatedAt: FIXTURE_GENERATED_AT,
    mfdVersion: FIXTURE_MFD_VERSION,
  });
}

describe('buildReport', () => {
  it('populates every section the owner listed, in order', () => {
    const model = report();

    // The order is data (SECTION_ORDER) so a renderer cannot quietly reorder the document.
    // Asserted against the model's own keys, so adding a section without placing it in the
    // order fails here.
    for (const section of SECTION_ORDER) {
      expect(model[section], section).toBeDefined();
    }
    expect(SECTION_ORDER).toEqual([
      'cover',
      'summary',
      'equipmentSchedule',
      'floorPlans',
      'validation',
      'checklist',
      'installation',
      'datasheets',
      'standards',
      'notice',
    ]);
  });

  it('is pure — the same inputs produce identical JSON twice', () => {
    // The property that makes a server's report comparable to the browser's rather than
    // merely similar (AD-3). A clock, a Math.random, or an iteration over a Set would all
    // break this quietly.
    expect(JSON.stringify(report())).toBe(JSON.stringify(report()));
  });

  it('survives a JSON round trip with no loss', () => {
    // JSON is one of the four output formats, and the model is what it serialises. A Date,
    // a Map or an undefined here would be a field that silently disappears from the JSON
    // renderer while the PDF still shows it.
    const model = report();
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });

  it('takes its timestamp from the caller, never a clock', () => {
    const model = report();

    expect(model.generatedAt).toBe(FIXTURE_GENERATED_AT);
    expect(model.provenance.generatedAt).toBe(FIXTURE_GENERATED_AT);
    expect(model.cover.date).toBe('2026-07-30');
  });

  it('covers every level, not the one that happened to be selected', () => {
    const model = report();

    expect(model.floorPlans.map((plan) => plan.levelName)).toEqual(['4F', '5F']);
    expect(model.validation.map((section) => section.levelName)).toEqual(['4F', '5F']);
  });

  it('carries the customer details as typed, including Hangul', () => {
    const model = report();

    expect(model.cover.hospital).toBe('서울 하늘병원');
    expect(model.cover.site).toBe('본관 4층');
    expect(model.cover.tsEngineer).toBe('A. Engineer');
  });

  it('stamps every contract version it was built against', () => {
    // A report that cannot say which contracts produced it cannot be re-derived. All four
    // versions, because a mismatch in any one of them changes what the numbers mean.
    const { provenance } = report();

    // 2 since the owner's AK98 source clarification split the datasheet's sourced block into
    // `specification_data` and `installation_data`. A consumer holding a version 1 report would
    // read `manufacturer_data`, find nothing, and print an empty datasheet without saying so.
    expect(provenance.reportVersion).toBe(2);
    // 5 since Q-4: `PlanImage.renderDpi`, which is what lets the printed-scale calibration route
    // be offered for a drawing whose resolution we know. Written as a literal rather than imported
    // from the schema on purpose — a shape lock that read `DOCUMENT_VERSION` would follow any bump
    // silently, and the point of this line is that changing what a report says about its own
    // provenance has to be a deliberate edit somebody made.
    expect(provenance.documentVersion).toBe(5);
    // 3 since owner decision D5 widened `EvaluationResult.category` with `equipment_data`, for a
    // finding that is not about a rule: the placement whose catalogue record is missing. A literal
    // for the same reason as the line above — a report that quietly followed the bump would tell a
    // consumer nothing had changed about what its findings can say.
    expect(provenance.evaluationResultVersion).toBe(3);
    expect(provenance.ruleSetId).toBe('fixture');
    expect(provenance.ruleSetVersion).toBe('0.0.1');
    expect(provenance.mfdVersion).toBe(FIXTURE_MFD_VERSION);
    expect(provenance.catalogueVersions).toEqual([{ id: 'fixture_machine', version: '1.0.0' }]);
  });

  it('produces a complete report from an empty project', () => {
    // The case a report engine is most likely to get wrong by producing something that
    // looks finished. Every section must still exist, and the verdict must not be a pass.
    const model = report(emptyDocument());

    for (const section of SECTION_ORDER) {
      expect(model[section], section).toBeDefined();
    }
    expect(model.summary.totalEquipment).toBe(0);
    expect(model.summary.verdict).toBe('inconclusive');
    expect(model.equipmentSchedule.rows).toEqual([]);
    expect(model.datasheets).toEqual([]);
    // The notice is unconditional. A liability statement that appears on most reports is
    // not a liability statement.
    expect(model.notice.liability.ko.length).toBeGreaterThan(0);
    expect(model.notice.liability.en.length).toBeGreaterThan(0);
    // And the checklist still has its standing items, because a water loop needs
    // commissioning whether or not this drawing turned anything up.
    expect(model.checklist.categories.length).toBeGreaterThan(0);
    expect(
      model.checklist.categories.flatMap((category) => category.items).length,
    ).toBeGreaterThan(0);
  });
});

describe('the equipment schedule', () => {
  it('counts one row per model across every level', () => {
    // Four machines of one model across two floors: one row, quantity four. An engineer
    // ordering equipment wants one number for the job.
    const { rows } = report().equipmentSchedule;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.model).toBe('FX-1');
    expect(rows[0]?.quantity).toBe(4);
  });

  it('keeps manufacturer dimensions and design footprint as separate values', () => {
    const row = report().equipmentSchedule.rows[0];

    expect(row?.manufacturerDimensions).toEqual({
      width: 585,
      depth: 620,
      height: 1_305,
      weight: null,
    });
    expect(row?.planningFootprint.width).toBe(800);
    expect(row?.planningFootprint.depth).toBe(800);
  });

  it('reports a placement whose catalogue record has gone, rather than dropping it', () => {
    const document = populatedDocument();
    const level = document.project.levels[0];
    if (!level) throw new Error('fixture has no level');

    const orphaned = {
      ...document,
      project: {
        ...document.project,
        levels: [
          {
            ...level,
            placements: [
              ...level.placements,
              { ...level.placements[0]!, id: 'placement-orphan', equipmentObjectId: 'gone' },
            ],
          },
          ...document.project.levels.slice(1),
        ],
      },
    };

    // A machine silently missing from a schedule is a machine nobody orders.
    expect(report(orphaned).equipmentSchedule.unknownEquipmentIds).toEqual(['gone']);
  });
});

describe('the floor plan section', () => {
  it('numbers placements and keys the findings to those numbers', () => {
    const model = report();
    const plan = model.floorPlans[0];
    const validation = model.validation[0];

    expect(plan?.placements.map((row) => row.number)).toEqual([1, 2, 3]);

    // Every finding on this level points at a number the drawing shows. Without that a
    // reader has a page of circles and a page of rows and has to join them by eye.
    for (const finding of validation?.findings ?? []) {
      for (const number of finding.placementNumbers) {
        expect(plan?.placements.some((row) => row.number === number)).toBe(true);
      }
    }
  });

  it('records the drawing, the calibration and the mapping when they exist', () => {
    const plan = report().floorPlans[0];

    expect(plan?.drawing?.sourceFileName).toBe('ward-4f.pdf');
    expect(plan?.calibration?.millimetresPerPixel).toBe(10);
    expect(plan?.mapping?.originPixel).toEqual({ x: 100, y: 100 });
  });

  it('says a level was never calibrated rather than leaving it blank', () => {
    // 5F has a plan and no mapping — the one state that must never look ordinary.
    const plan = report().floorPlans[1];

    expect(plan?.drawing).not.toBeNull();
    expect(plan?.calibration).toBeNull();
    expect(plan?.mapping).toBeNull();
  });

  it('reports rooms and obstructions in square metres', () => {
    const plan = report().floorPlans[0];

    // 8 m × 6 m.
    expect(plan?.rooms[0]?.areaSquareMetres).toBe(48);
    expect(plan?.rooms[0]?.name).toBe('Treatment area A');
    // 600 mm × 600 mm column.
    expect(plan?.obstructions[0]?.areaSquareMetres).toBe(0.36);
    expect(plan?.obstructions[0]?.obstructionType).toBe('column');
  });

  it('carries geometry for the drawing page, in millimetres', () => {
    const plan = report().floorPlans[0];

    expect(plan?.geometry.rooms).toHaveLength(1);
    expect(plan?.geometry.obstructions).toHaveLength(1);
    expect(plan?.geometry.equipment).toHaveLength(3);
    // The extent bounds the room, so a renderer can fit a page without measuring again.
    expect(plan?.geometry.extent).toEqual({ minX: 0, minY: 0, maxX: 8_000, maxY: 6_000 });
  });

  it('lists the reference points a level records, with their kind and position', () => {
    const plan = report().floorPlans[0];

    expect(plan?.referencePoints).toEqual([
      { kind: 'drain', kindLabel: 'ref_drain', label: null, position: { x: 200, y: 2_800 } },
      {
        kind: 'electrical_panel',
        kindLabel: 'ref_electrical_panel',
        label: 'DB-4F-2',
        position: { x: 4_400, y: 300 },
      },
    ]);
    expect(plan?.geometry.referencePoints).toHaveLength(2);
  });

  it('leaves the list empty for a level with none, rather than inventing one', () => {
    // 5F records no points. The report has to be able to say so — four of the approved scoring
    // criteria measure from one of these, so an empty list is 40 % of the model that cannot be
    // computed, not an absence of anything worth mentioning.
    const plan = report().floorPlans[1];

    expect(plan?.referencePoints).toEqual([]);
    expect(plan?.geometry.referencePoints).toEqual([]);
  });

  it('keeps reference points out of the drawing extent', () => {
    // The panel sits at x = 4,400 which is inside the room, so this needs a point deliberately
    // outside it to mean anything. A point in a corridor beyond the traced rooms would otherwise
    // stretch the bounding box and shrink the layout the reader came to look at.
    const document = populatedDocument();
    const level = document.project.levels[0];
    if (!level) throw new Error('fixture has no level');

    const stretched = report({
      ...document,
      project: {
        ...document.project,
        levels: [
          {
            ...level,
            referencePoints: [
              ...level.referencePoints,
              { id: 'far', kind: 'access_entry' as const, position: { x: 40_000, y: 0 }, label: null },
            ],
          },
          ...document.project.levels.slice(1),
        ],
      },
    });

    expect(stretched.floorPlans[0]?.geometry.extent?.maxX).toBe(8_000);
    expect(stretched.floorPlans[0]?.geometry.referencePoints).toHaveLength(3);
  });
});

describe('the standards section', () => {
  it('lists every rule in the set, including ones that produced nothing', () => {
    const { rules } = report().standards;

    // "List every applied standard", taken literally. A rule that fired on nothing is what
    // a reviewer needs to see — it means either nothing was governed by it, or its
    // selector matches nothing and it has been silently passing.
    expect(rules.map((rule) => rule.ruleId).sort()).toEqual([
      'fixture_boundary',
      'fixture_front_clearance',
      'fixture_overlap',
    ]);
    for (const rule of rules) {
      expect(rule.ruleName.ko.length).toBeGreaterThan(0);
      expect(rule.ruleName.en.length).toBeGreaterThan(0);
      expect(typeof rule.findingCount).toBe('number');
    }
  });
});
