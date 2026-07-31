import { describe, expect, it } from 'vitest';

/**
 * An unsourced group. Verification is **per group** now, so a fixture has to say it
 * once per group rather than once per record.
 */
function draftVerification() {
  return {
    status: 'draft',
    source: {
      document: null,
      revision: null,
      section: null,
      type: 'estimate',
      lastUpdated: '2026-07-29',
    },
  };
}

/** A sourced **specification** group. */
function verifiedVerification(section = '2.1 Dimensions') {
  return {
    status: 'verified',
    source: {
      document: 'AK 98 Operator Manual',
      revision: 'Rev. 4',
      section,
      type: 'manufacturer_manual',
      lastUpdated: '2026-07-31',
    },
  };
}

/**
 * A sourced **installation** group.
 *
 * A separate citation because the schema now allows no other kind on this side: an installation
 * group's source vocabulary contains no manufacturer document at all.
 */
function verifiedInstallationVerification(section = '3.2 Station clearances') {
  return {
    status: 'verified',
    source: {
      document: 'Vantive TS Installation Standard',
      revision: 'Rev. 1',
      section,
      type: 'ts_installation_standard',
      lastUpdated: '2026-07-31',
    },
  };
}

/** Cite every group on a raw record, each from the document its side allows. */
function citeEveryGroup(raw: Record<string, unknown>): Record<string, unknown> {
  for (const group of VERIFIED_FIELD_GROUPS) {
    const cited =
      FIELD_GROUP_ORIGIN[group] === 'installation'
        ? verifiedInstallationVerification()
        : verifiedVerification();

    if (group === 'power' || group === 'roWater' || group === 'drain') {
      (raw['connections'] as Record<string, Record<string, unknown>>)[group]!['verification'] =
        cited;
    } else {
      const key = group === 'manufacturerDimensions' ? 'manufacturerDimensions' : group;
      (raw[key] as Record<string, unknown>)['verification'] = cited;
    }
  }
  return raw;
}

import { catalog } from '../catalog/index';
import { createCatalog } from './catalog';
import { CatalogValidationError, DuplicateEquipmentIdError } from './errors';
import {
  CLEARANCE_SIDES,
  FIELD_GROUP_ORIGIN,
  VERIFIED_FIELD_GROUPS,
  fieldVerification,
  groupsWithStatus,
} from './schema';

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'test_machine',
    manufacturer: 'Test',
    model: 'T1',
    category: 'dialysis_machine',
    version: '0.1.0',
    manufacturerDimensions: { width: null, depth: null, height: null, weight: null, verification: draftVerification() },
    planningFootprint: { width: 800, depth: 700, basis: null },
    connections: {
      power: { required: true, specification: null, verification: draftVerification() },
      roWater: { required: true, specification: null, verification: draftVerification() },
      drain: { required: true, specification: null, verification: draftVerification() },
    },
    serviceClearance: { front: null, rear: null, left: null, right: null, verification: draftVerification() },
    environmental: { specification: null, verification: draftVerification() },
    maintenanceAccess: { front: null, rear: null, left: null, right: null, verification: draftVerification() },
    portLocations: { power: null, roWater: null, drain: null, verification: draftVerification() },
    installationRouting: { specification: null, verification: draftVerification() },
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

  it('lists records with any draft group separately', () => {
    const fully = citeEveryGroup(record({ id: 'verified_machine' }));

    const built = createCatalog([
      { fileName: 'a.json', raw: record() },
      { fileName: 'b.json', raw: fully },
    ]);

    expect(built.draftObjects.map((object) => object.id)).toEqual(['test_machine']);
  });

  it('counts a record with one draft group among the drafts', () => {
    // Partly verified is still partly unknown, and the interface has to say so — even
    // though a verdict computed only from the verified group is not downgraded.
    const partly = record({ id: 'partly' }) as Record<string, unknown>;
    (partly['manufacturerDimensions'] as Record<string, unknown>)['verification'] =
      verifiedVerification('2.1 Dimensions');

    const built = createCatalog([{ fileName: 'a.json', raw: partly }]);

    expect(built.draftObjects.map((object) => object.id)).toEqual(['partly']);
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

  it('has no verified group on the AK98 yet, because nothing is cited', () => {
    // Its dimensions are real figures from the product owner. What is missing is the
    // citation — no document, revision or section — so `verified` would be a claim the
    // record cannot support. Per-group verification means each of these flips on its own
    // the moment its reference arrives.
    const ak98 = catalog.require('vantive_ak98');

    expect(groupsWithStatus(ak98, 'verified')).toEqual([]);
    expect(catalog.draftObjects).toContain(ak98);
  });

  it('invents no engineering data', () => {
    const ak98 = catalog.require('vantive_ak98');

    // Everything not yet taken from a manual must be null, not a plausible number.
    expect(ak98.manufacturerDimensions.weight).toBeNull();
    expect(ak98.environmental.specification).toBeNull();
    /*
     * The footprint's basis names the decision behind it, and that is not invented engineering
     * data — it is an account of an owner decision, which is what `basis` is for. What would be an
     * invention is a *number* nobody supplied, and the assertions around this one cover those.
     *
     * It was null until the owner's AK98 source clarification supplied both the figure and the
     * reasoning; the sentence must name that decision rather than reading as a general remark.
     */
    expect(ak98.planningFootprint.basis).toContain('Owner decision');
    expect(ak98.planningFootprint.basis).toContain('Does not replace the manufacturer dimension');
    // Every side null, which is what makes every clearance finding read "threshold
    // unknown". Asserted side by side rather than by comparing the whole group, which
    // also carries a verification block checked separately.
    for (const side of CLEARANCE_SIDES) {
      expect(ak98.serviceClearance[side]).toBeNull();
    }
    expect(ak98.connections.power.specification).toBeNull();
    expect(ak98.connections.roWater.specification).toBeNull();
    expect(ak98.connections.drain.specification).toBeNull();
    // No group can cite itself, which is why none of them is verified.
    for (const group of VERIFIED_FIELD_GROUPS) {
      expect(fieldVerification(ak98, group).source.document).toBeNull();
      expect(fieldVerification(ak98, group).source.revision).toBeNull();
      expect(fieldVerification(ak98, group).source.section).toBeNull();
    }
  });

  it('records that the machine needs all three services even though the specs are unknown', () => {
    const ak98 = catalog.require('vantive_ak98');

    expect(ak98.connections.power.required).toBe(true);
    expect(ak98.connections.roWater.required).toBe(true);
    expect(ak98.connections.drain.required).toBe(true);
  });
});
