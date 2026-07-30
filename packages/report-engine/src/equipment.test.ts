import { describe, expect, it } from 'vitest';

import { buildDatasheet } from './equipment';
import { fixtureCatalog, fixtureEquipmentRecord } from '../fixtures/index';

/**
 * Section 7 — the datasheet, and the owner's instruction that manufacturer data is never
 * mixed with planning data.
 *
 * The case these tests exist for is the **mixed record**: dimensions cited, clearances not.
 * Under record-level verification that record had one status and one heading; now it has to
 * appear in two blocks at once, and the design footprint in neither.
 */

function objectWith(options: Parameters<typeof fixtureEquipmentRecord>[0]) {
  const catalog = fixtureCatalog([fixtureEquipmentRecord(options)]);
  return catalog.require(options?.id ?? 'fixture_machine');
}

describe('the equipment datasheet', () => {
  it('splits a mixed record into a verified block and a draft block', () => {
    // The owner's example: dimensions and electrical cited, service clearance not.
    const sheet = buildDatasheet(
      objectWith({ verifiedGroups: ['manufacturerDimensions', 'power'] }),
    );

    expect(sheet.manufacturer_data.map((block) => block.group)).toEqual([
      'group_manufacturerDimensions',
      'group_power',
    ]);
    expect(sheet.draft_data.map((block) => block.group)).toEqual([
      'group_serviceClearance',
      'group_roWater',
      'group_drain',
      'group_environmental',
    ]);
  });

  it('names the citation on every verified block and on no draft block', () => {
    const sheet = buildDatasheet(objectWith({ verifiedGroups: ['manufacturerDimensions'] }));

    // Per block, because two groups can come from different documents — a datasheet for the
    // dimensions and the installation manual for the clearances is the ordinary case.
    expect(sheet.manufacturer_data[0]?.citation).toBe(
      'Fixture Installation Manual · Rev. 2 · 4.1 Dimensions',
    );
    for (const block of sheet.draft_data) {
      expect(block.citation, block.group).toBeNull();
    }
  });

  it('keeps the design footprint out of both blocks', () => {
    // Three blocks, not two. The footprint is an owner planning decision with no manual
    // behind it: filing it under "draft" would read as a figure nobody had got round to
    // sourcing, and under "manufacturer data" it would be a false citation.
    const sheet = buildDatasheet(objectWith({ verifiedGroups: ['manufacturerDimensions'] }));

    const inBlocks = [...sheet.manufacturer_data, ...sheet.draft_data].flatMap(
      (block) => block.fields,
    );
    expect(inBlocks.some((field) => field.label === 'field_design_footprint')).toBe(false);

    expect(sheet.designFootprint).toEqual([
      { label: 'field_design_footprint', value: '800 × 800 mm' },
      { label: 'field_footprint_basis', value: 'Fixture planning allowance' },
    ]);
  });

  it('emits no draft block at all when every group is cited', () => {
    // An empty heading reads as a section somebody forgot to fill in.
    const sheet = buildDatasheet(
      objectWith({
        verifiedGroups: [
          'manufacturerDimensions',
          'serviceClearance',
          'power',
          'roWater',
          'drain',
          'environmental',
        ],
      }),
    );

    expect(sheet.draft_data).toEqual([]);
    expect(sheet.manufacturer_data).toHaveLength(6);
  });

  it('emits no verified block when nothing is cited — the shipped state', () => {
    const sheet = buildDatasheet(objectWith({}));

    expect(sheet.manufacturer_data).toEqual([]);
    expect(sheet.draft_data).toHaveLength(6);
  });

  it('names each clearance side rather than printing one number', () => {
    const sheet = buildDatasheet(
      objectWith({ verifiedGroups: ['serviceClearance'] }),
    );
    const clearance = sheet.manufacturer_data.find(
      (block) => block.group === 'group_serviceClearance',
    );

    // "clearance: 1200" does not say which side, and the four sides are rarely equal.
    expect(clearance?.fields[0]?.value).toBe('front 1200 mm · rear 800 mm · left 400 mm · right 400 mm');
  });

  it('distinguishes "required, specification unknown" from "not required"', () => {
    // An engineer sizing a supply needs to tell these apart. A single blank cell cannot.
    const sheet = buildDatasheet(objectWith({}));
    const power = sheet.draft_data.find((block) => block.group === 'group_power');

    expect(power?.fields[0]?.value).toBeNull();
  });

  it('reports a generic planning object with no manufacturer figures at all', () => {
    const sheet = buildDatasheet(
      objectWith({
        id: 'planning_bed',
        model: 'Dialysis Bed',
        manufacturer: null,
        width: 1_000,
        depth: 2_100,
        manufacturerDimensions: { width: null, depth: null, height: null, weight: null },
      }),
    );

    expect(sheet.manufacturer).toBeNull();
    // The footprint still stands on its own — a bed is a footprint, not a product.
    expect(sheet.designFootprint[0]?.value).toBe('1000 × 2100 mm');
    const dimensions = sheet.draft_data.find(
      (block) => block.group === 'group_manufacturerDimensions',
    );
    expect(dimensions?.fields.every((field) => field.value === null)).toBe(true);
  });
});
