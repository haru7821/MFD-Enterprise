import { describe, expect, it } from 'vitest';

import { catalog } from '../catalog/index';
import { createCatalog } from './catalog';
import { CatalogValidationError, DuplicateEquipmentIdError } from './errors';

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'test_machine',
    manufacturer: 'Test',
    model: 'T1',
    category: 'dialysis_machine',
    version: '0.1.0',
    dataStatus: 'draft',
    dimensions: { width: 800, depth: 700, height: null, weight: null },
    connections: {
      power: { required: true, port: null, specification: null },
      roWater: { required: true, port: null, specification: null },
      drain: { required: true, port: null, specification: null },
    },
    serviceClearance: { front: null, rear: null, left: null, right: null },
    source: {
      document: null,
      revision: null,
      section: null,
      type: 'estimate',
      lastUpdated: '2026-07-29',
    },
    symbol: { origin: 'front-left', outline: 'rectangle', frontEdge: 'south' },
    ...overrides,
  };
}

describe('createCatalog', () => {
  it('indexes records by id', () => {
    const built = createCatalog([{ fileName: 'a.json', raw: record() }]);

    expect(built.objects).toHaveLength(1);
    expect(built.get('test_machine')?.model).toBe('T1');
    expect(built.get('does_not_exist')).toBeUndefined();
  });

  it('refuses to load when any record is invalid', () => {
    // A catalogue that dropped the bad record would show the engineer a shorter
    // equipment list and no reason why.
    expect(() =>
      createCatalog([
        { fileName: 'good.json', raw: record() },
        { fileName: 'bad.json', raw: record({ category: 'not_a_category' }) },
      ]),
    ).toThrow(CatalogValidationError);
  });

  it('names the offending file, not just the problem', () => {
    try {
      createCatalog([{ fileName: 'broken_machine.json', raw: record({ version: 'one' }) }]);
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as CatalogValidationError).fileName).toBe('broken_machine.json');
    }
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      createCatalog([
        { fileName: 'a.json', raw: record() },
        { fileName: 'b.json', raw: record({ model: 'T2' }) },
      ]),
    ).toThrow(DuplicateEquipmentIdError);
  });

  it('require() throws for an unknown id', () => {
    const built = createCatalog([{ fileName: 'a.json', raw: record() }]);

    expect(() => built.require('ghost')).toThrow(/ghost/);
  });

  it('lists draft records separately', () => {
    const built = createCatalog([
      { fileName: 'a.json', raw: record() },
      {
        fileName: 'b.json',
        raw: record({
          id: 'verified_machine',
          dataStatus: 'verified',
          source: {
            document: 'Manual',
            revision: 'Rev. 1',
            section: '2.1',
            type: 'manufacturer_manual',
            lastUpdated: '2026-07-29',
          },
        }),
      },
    ]);

    expect(built.draftObjects.map((object) => object.id)).toEqual(['test_machine']);
  });
});

describe('the shipped catalogue', () => {
  it('loads', () => {
    expect(catalog.objects.length).toBeGreaterThan(0);
  });

  it('contains the Vantive AK98', () => {
    const ak98 = catalog.require('vantive_ak98');

    expect(ak98.manufacturer).toBe('Vantive');
    expect(ak98.model).toBe('AK98');
    expect(ak98.category).toBe('dialysis_machine');
  });

  it('marks the AK98 as draft, because its figures are placeholders', () => {
    const ak98 = catalog.require('vantive_ak98');

    expect(ak98.dataStatus).toBe('draft');
    expect(catalog.draftObjects).toContain(ak98);
  });

  it('invents no engineering data', () => {
    const ak98 = catalog.require('vantive_ak98');

    // Everything not yet taken from a manual must be null, not a plausible number.
    expect(ak98.dimensions.height).toBeNull();
    expect(ak98.dimensions.weight).toBeNull();
    expect(ak98.serviceClearance).toEqual({
      front: null,
      rear: null,
      left: null,
      right: null,
    });
    expect(ak98.connections.power.specification).toBeNull();
    expect(ak98.connections.roWater.specification).toBeNull();
    expect(ak98.connections.drain.specification).toBeNull();
    expect(ak98.source.document).toBeNull();
    expect(ak98.source.revision).toBeNull();
    expect(ak98.source.section).toBeNull();
  });

  it('records that the machine needs all three services even though the specs are unknown', () => {
    const ak98 = catalog.require('vantive_ak98');

    expect(ak98.connections.power.required).toBe(true);
    expect(ak98.connections.roWater.required).toBe(true);
    expect(ak98.connections.drain.required).toBe(true);
  });
});
