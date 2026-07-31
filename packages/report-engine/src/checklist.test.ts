import { describe, expect, it } from 'vitest';

import { VERIFIED_FIELD_GROUPS } from '@mfd/object-library';
import { evaluate } from '@mfd/rule-engine';

import { buildChecklist } from './checklist';
import { parseChecklistTemplate } from './checklistTemplate';
import { dialysisChecklistTemplate } from '../checklists/index';
import {
  fixtureCatalog,
  fixtureChecklistTemplate,
  fixtureRuleSet,
  populatedDocument,
} from '../fixtures/index';

/**
 * Section 6 — the installation checklist.
 *
 * The two halves are the thing under test, because either alone is wrong:
 *
 * - Only standing items → a form that ignores the assessment.
 * - Only derived items → **empty** on a drawing with no equipment, and an engineer still
 *   has a water loop to commission.
 */

function checklist(options: { withFindings?: boolean; verifiedGroups?: never[] } = {}) {
  const catalog = fixtureCatalog();
  const document = populatedDocument(catalog);
  const level = document.project.levels[0];
  if (!level) throw new Error('fixture has no level');

  const reports = options.withFindings
    ? [
        evaluate({
          placements: level.placements,
          catalog,
          ruleSet: fixtureRuleSet(),
          spatial: { boundaries: level.boundaries, planStatus: 'calibrated' },
        }),
      ]
    : [];

  return buildChecklist({
    template: fixtureChecklistTemplate(),
    reports,
    equipmentInUse: [catalog.require('fixture_machine')],
    uncalibratedLevelNames: ['5F'],
  });
}

describe('the installation checklist', () => {
  it('keeps every category from the template, in template order', () => {
    // The categories are data in standards/, so "add a commissioning step" is a JSON change
    // rather than a release. That only holds if the builder does not reorder or filter them.
    const { categories } = checklist();

    expect(categories.map((category) => category.id)).toEqual([
      'electrical',
      'accessibility',
      'final_engineer_check',
    ]);
  });

  it('has standing items even when nothing was found', () => {
    const { categories } = checklist();

    for (const category of categories) {
      expect(
        category.items.some((item) => item.origin === 'standard'),
        category.id,
      ).toBe(true);
    }
  });

  it('puts derived items before standing ones', () => {
    // An item this drawing produced outranks a standing step: it is the thing the reader did
    // not already know.
    const accessibility = checklist({ withFindings: true }).categories.find(
      (category) => category.id === 'accessibility',
    );
    const origins = accessibility?.items.map((item) => item.origin) ?? [];

    const firstStanding = origins.indexOf('standard');
    const lastDerived = origins.lastIndexOf('finding');
    expect(firstStanding).toBeGreaterThan(-1);
    expect(lastDerived).toBeLessThan(firstStanding);
  });

  it('derives an item per finding that needs action, and none for a pass', () => {
    const accessibility = checklist({ withFindings: true }).categories.find(
      (category) => category.id === 'accessibility',
    );
    const derived = accessibility?.items.filter((item) => item.origin === 'finding') ?? [];

    expect(derived.length).toBeGreaterThan(0);
    // Every derived item traces back to a rule, so the checklist cannot drift out of step
    // with the assessment.
    for (const item of derived) {
      expect(item.ruleId).not.toBeNull();
      expect(item.reasonCode).not.toBeNull();
    }
    // RED must be resolved; YELLOW confirmed on site. Both appear.
    expect(derived.some((item) => item.action === 'action_resolve')).toBe(true);
  });

  it('derives one item per draft field group, not one per record', () => {
    // The record-level behaviour the owner replaced would reappear here as a single
    // "this machine is unverified" item, which tells an engineer nothing about what to ask
    // the manufacturer for.
    const items = checklist()
      .categories.flatMap((category) => category.items)
      .filter((item) => item.origin === 'data_gap');

    // One per field group on the fixture record, all draft. Counted from the package's own list
    // rather than hard-coded: the owner's AK98 source clarification added three installation
    // groups, and a literal 6 here would have gone from "one item per gap" to "six of the nine".
    expect(items).toHaveLength(VERIFIED_FIELD_GROUPS.length);
    for (const item of items) {
      expect(item.action).toBe('action_obtain_manual');
      expect(item.text?.ko).toMatch(/[가-힣]/);
      expect(item.text?.en).toContain('manufacturer documentation');
    }
  });

  it('never drops a derived item whose category the template lacks', () => {
    // A template is customer-editable data and need not carry a category per group. Before
    // this was handled, a three-category template silently lost several of the data-gap
    // items — "obtain the drain specification" vanishing because a site's template has no
    // Drain heading, with nothing anywhere saying so.
    const single = parseChecklistTemplate('one.json', {
      id: 'one',
      version: '1',
      categories: [{ id: 'only', title: { ko: '유일', en: 'Only' }, items: [] }],
    });

    const catalog = fixtureCatalog();
    const built = buildChecklist({
      template: single,
      reports: [],
      equipmentInUse: [catalog.require('fixture_machine')],
      uncalibratedLevelNames: ['5F'],
    });

    const items = built.categories.flatMap((category) => category.items);
    // One item per draft group plus one calibration item, all reachable.
    expect(items.filter((item) => item.origin === 'data_gap')).toHaveLength(
      VERIFIED_FIELD_GROUPS.length,
    );
    expect(items.filter((item) => item.origin === 'calibration')).toHaveLength(1);
  });

  it('files a draft group under the trade that needs it', () => {
    const byCategory = new Map(
      checklist().categories.map((category) => [
        category.id,
        category.items.filter((item) => item.origin === 'data_gap'),
      ]),
    );

    // An electrician chasing a voltage looks under Electrical, not under a generic
    // "outstanding data" heading.
    expect(byCategory.get('electrical')?.some((item) => item.text?.en.includes('electrical'))).toBe(
      true,
    );
  });

  it('raises an item for an uncalibrated level', () => {
    const final = checklist().categories.find(
      (category) => category.id === 'final_engineer_check',
    );
    const calibration = final?.items.filter((item) => item.origin === 'calibration') ?? [];

    expect(calibration).toHaveLength(1);
    expect(calibration[0]?.text?.en).toContain('5F');
    expect(calibration[0]?.action).toBe('action_calibrate');
  });

  it('is bilingual in every item, whatever its origin', () => {
    // The owner's decision covers recommendations too. A derived item carries a reason code
    // the renderer composes; a standing item carries its own pair. Neither may be missing.
    for (const category of checklist({ withFindings: true }).categories) {
      expect(category.title.ko).toMatch(/[가-힣]/);
      expect(category.title.en.length).toBeGreaterThan(0);

      for (const item of category.items) {
        const hasText = item.text !== null && item.text.ko.length > 0 && item.text.en.length > 0;
        const hasCode = item.reasonCode !== null;
        expect(hasText || hasCode, `${category.id}/${item.origin}`).toBe(true);
      }
    }
  });
});

describe('the shipped template', () => {
  it('covers the six categories the owner listed', () => {
    expect(dialysisChecklistTemplate.categories.map((category) => category.id)).toEqual([
      'electrical',
      'ro_water',
      'drain',
      'network',
      'accessibility',
      'final_engineer_check',
    ]);
  });

  it('is bilingual throughout', () => {
    for (const category of dialysisChecklistTemplate.categories) {
      expect(category.title.ko).toMatch(/[가-힣]/);
      expect(category.items.length).toBeGreaterThan(0);
      for (const item of category.items) {
        expect(item.text.ko, `${category.id}/${item.id}`).toMatch(/[가-힣]/);
        expect(item.text.en.length, `${category.id}/${item.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('rejects a template with a missing translation, naming the field', () => {
    // A malformed template must fail at load, not produce a report with a blank heading. The
    // path matters: "invalid template" without a field name is a message nobody can act on.
    expect(() =>
      parseChecklistTemplate('broken.json', {
        id: 'broken',
        version: '1',
        categories: [
          { id: 'electrical', title: { en: 'Electrical' }, items: [] },
        ],
      }),
    ).toThrow(/categories\.0\.title\.ko/);
  });

  it('rejects an unknown key rather than ignoring it', () => {
    // Same discipline as the rule and catalogue loaders: a misspelled key must not look like
    // a field somebody chose to leave out.
    expect(() =>
      parseChecklistTemplate('broken.json', {
        id: 'broken',
        version: '1',
        catgories: [],
      }),
    ).toThrow(/broken\.json/);
  });
});
