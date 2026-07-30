import { describe, expect, it } from 'vitest';

import { CatalogValidationError } from './errors';
import { parseEquipmentObject } from './catalog';
import type { EquipmentObject } from './schema';

/**
 * A record that must always pass, used as the base for every rejection case below.
 * Building each bad case by breaking one field of a known-good record keeps the
 * tests honest: a failure means the field under test, not an unrelated typo.
 */
function validRecord(): Record<string, unknown> {
  return {
    id: 'vantive_ak98',
    manufacturer: 'Vantive',
    model: 'AK98',
    category: 'dialysis_machine',
    version: '0.1.0',
    dataStatus: 'draft',
    manufacturerDimensions: { width: 585, depth: 620, height: 1_305, weight: null },
      designFootprint: { width: 900, depth: 750, basis: null },
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
  };
}

function parse(record: unknown): EquipmentObject {
  return parseEquipmentObject(record, 'test_record.json');
}

/** Capture the issue paths a rejection reported. */
function issuePathsOf(record: unknown): string[] {
  try {
    parse(record);
  } catch (error) {
    if (error instanceof CatalogValidationError) {
      return error.issues.map((issue) => issue.path);
    }
    throw error;
  }
  throw new Error('Expected the record to be rejected, but it parsed successfully.');
}

describe('a valid record', () => {
  it('parses', () => {
    const object = parse(validRecord());

    expect(object.id).toBe('vantive_ak98');
    expect(object.designFootprint.width).toBe(900);
    expect(object.manufacturerDimensions.width).toBe(585);
    expect(object.dataStatus).toBe('draft');
  });
});

describe('missing fields are rejected', () => {
  it.each([
    'id',
    'manufacturer',
    'model',
    'category',
    'version',
    'dataStatus',
    'manufacturerDimensions',
  'designFootprint',
    'connections',
    'serviceClearance',
    'source',
    'symbol',
  ])('rejects a record with no "%s"', (field) => {
    const record = validRecord();
    delete record[field];

    expect(issuePathsOf(record)).toContain(field);
  });

  it('rejects a nested field that is omitted rather than set to null', () => {
    const record = validRecord();
    delete (record['manufacturerDimensions'] as Record<string, unknown>)['height'];

    // The whole point of nullable-but-required: forgetting a field must not look
    // the same as recording that its value is unknown.
    expect(issuePathsOf(record)).toContain('manufacturerDimensions.height');
  });

  it('rejects a missing clearance side', () => {
    const record = validRecord();
    delete (record['serviceClearance'] as Record<string, unknown>)['rear'];

    expect(issuePathsOf(record)).toContain('serviceClearance.rear');
  });
});

describe('invalid types are rejected', () => {
  it('rejects a string where a length is expected', () => {
    const record = validRecord();
    (record['designFootprint'] as Record<string, unknown>)['width'] = '900';

    expect(issuePathsOf(record)).toContain('designFootprint.width');
  });

  it('rejects a zero or negative footprint', () => {
    for (const bad of [0, -900]) {
      const record = validRecord();
      (record['designFootprint'] as Record<string, unknown>)['width'] = bad;

      expect(issuePathsOf(record)).toContain('designFootprint.width');
    }
  });

  it('rejects a non-finite length', () => {
    const record = validRecord();
    (record['designFootprint'] as Record<string, unknown>)['depth'] = Number.POSITIVE_INFINITY;

    expect(issuePathsOf(record)).toContain('designFootprint.depth');
  });

  it('rejects an unknown category', () => {
    const record = validRecord();
    record['category'] = 'mri_scanner';

    expect(issuePathsOf(record)).toContain('category');
  });

  it('rejects an unknown dataStatus', () => {
    const record = validRecord();
    record['dataStatus'] = 'approved';

    expect(issuePathsOf(record)).toContain('dataStatus');
  });

  it('rejects a non-semver version', () => {
    const record = validRecord();
    record['version'] = 'v1';

    expect(issuePathsOf(record)).toContain('version');
  });

  it('rejects a malformed date', () => {
    const record = validRecord();
    (record['source'] as Record<string, unknown>)['lastUpdated'] = '29/07/2026';

    expect(issuePathsOf(record)).toContain('source.lastUpdated');
  });

  it('rejects an unknown key, so a misspelled field cannot be silently dropped', () => {
    const record = validRecord();
    record['dimension'] = { width: 900 };

    expect(() => parse(record)).toThrow(CatalogValidationError);
  });
});

describe('verified records must carry their source', () => {
  it('rejects verified with no document, revision or section', () => {
    const record = validRecord();
    record['dataStatus'] = 'verified';

    const paths = issuePathsOf(record);

    expect(paths).toContain('source.document');
    expect(paths).toContain('source.revision');
    expect(paths).toContain('source.section');
  });

  it.each(['document', 'revision', 'section'])(
    'rejects verified when only source.%s is missing',
    (field) => {
      const record = validRecord();
      record['dataStatus'] = 'verified';
      record['source'] = {
        document: 'AK 98 Installation Manual',
        revision: 'Rev. 4',
        section: '3.2 Installation clearances',
        type: 'manufacturer_manual',
        lastUpdated: '2026-07-29',
      };
      (record['source'] as Record<string, unknown>)[field] = null;

      expect(issuePathsOf(record)).toContain(`source.${field}`);
    },
  );

  it('accepts verified once the source and the footprint basis are complete', () => {
    const record = validRecord();
    record['dataStatus'] = 'verified';
    record['source'] = {
      document: 'AK 98 Installation Manual',
      revision: 'Rev. 4',
      section: '3.2 Installation clearances',
      type: 'manufacturer_manual',
      lastUpdated: '2026-07-29',
    };
    record['designFootprint'] = {
      width: 800,
      depth: 800,
      basis: 'Manufacturer envelope plus service allowance',
    };

    expect(parse(record).dataStatus).toBe('verified');
  });

  it('refuses verified while the design footprint has no basis', () => {
    // The hole the manufacturer/design split opens: a record whose *manufacturer*
    // figures are sourced but whose *planning* area is not. The footprint is what every
    // clearance and collision check measures, so an unaccounted-for one must not be able
    // to reach GREEN (AD-6a).
    const record = validRecord();
    record['dataStatus'] = 'verified';
    record['source'] = {
      document: 'AK 98 Installation Manual',
      revision: 'Rev. 4',
      section: '3.2 Installation clearances',
      type: 'manufacturer_manual',
      lastUpdated: '2026-07-29',
    };

    expect(issuePathsOf(record)).toContain('designFootprint.basis');
  });

  it('allows draft to omit its source, because that is what draft means', () => {
    expect(parse(validRecord()).source.document).toBeNull();
  });

  it('rejects an empty string standing in for a real reference', () => {
    const record = validRecord();
    record['dataStatus'] = 'verified';
    record['source'] = {
      document: '',
      revision: 'Rev. 4',
      section: '3.2',
      type: 'manufacturer_manual',
      lastUpdated: '2026-07-29',
    };

    expect(issuePathsOf(record)).toContain('source.document');
  });
});

describe('error reporting', () => {
  it('names the file and every bad field', () => {
    const record = validRecord();
    (record['designFootprint'] as Record<string, unknown>)['width'] = -1;
    record['category'] = 'nope';

    try {
      parse(record);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogValidationError);
      const message = (error as CatalogValidationError).message;

      expect(message).toContain('test_record.json');
      expect(message).toContain('designFootprint.width');
      expect(message).toContain('category');
    }
  });
});
