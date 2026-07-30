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

/** A sourced group. */
function verifiedVerification(section = '3.2 Installation clearances') {
  return {
    status: 'verified',
    source: {
      document: 'AK 98 Installation Manual',
      revision: 'Rev. 4',
      section,
      type: 'manufacturer_manual',
      lastUpdated: '2026-07-29',
    },
  };
}

import { CatalogValidationError } from './errors';
import { parseEquipmentObject } from './catalog';
import {
  type EquipmentObject,
  fieldStatus,
  fieldVerification,
  groupsWithStatus,
  hasDraftFields,
  isFullyVerified,
} from './schema';

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
    manufacturerDimensions: { width: 585, depth: 620, height: 1_305, weight: null, verification: draftVerification() },
      designFootprint: { width: 900, depth: 750, basis: null },
    connections: {
      power: { required: true, port: null, specification: null, verification: draftVerification() },
      roWater: { required: true, port: null, specification: null, verification: draftVerification() },
      drain: { required: true, port: null, specification: null, verification: draftVerification() },
    },
    serviceClearance: { front: null, rear: null, left: null, right: null, verification: draftVerification() },
    environmental: { specification: null, verification: draftVerification() },
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
    expect(fieldStatus(object, 'manufacturerDimensions')).toBe('draft');
  });

  it('lets a verified group sit beside a draft one', () => {
    // The whole point of per-group verification. A manual arrives in pieces: the
    // dimensions are citable months before anyone pins down the clearances, and a
    // record-level status forced the sourced figure to be reported as provisional.
    const record = validRecord();
    (record['manufacturerDimensions'] as Record<string, unknown>)['verification'] =
      verifiedVerification('2.1 Dimensions');

    const object = parse(record);

    expect(fieldStatus(object, 'manufacturerDimensions')).toBe('verified');
    expect(fieldStatus(object, 'serviceClearance')).toBe('draft');
    // Not downgraded by its neighbours — which is exactly what this replaces.
    expect(groupsWithStatus(object, 'verified')).toEqual(['manufacturerDimensions']);
    expect(hasDraftFields(object)).toBe(true);
    expect(isFullyVerified(object)).toBe(false);
  });

  it('reports fully verified only when every group is sourced', () => {
    const record = validRecord();
    for (const group of ['manufacturerDimensions', 'serviceClearance', 'environmental']) {
      (record[group] as Record<string, unknown>)['verification'] = verifiedVerification();
    }
    for (const kind of ['power', 'roWater', 'drain']) {
      ((record['connections'] as Record<string, Record<string, unknown>>)[kind] ?? {})[
        'verification'
      ] = verifiedVerification();
    }

    const object = parse(record);
    expect(isFullyVerified(object)).toBe(true);
    expect(groupsWithStatus(object, 'draft')).toEqual([]);
  });
});

describe('missing fields are rejected', () => {
  it.each([
    'id',
    'manufacturer',
    'model',
    'category',
    'version',
    'manufacturerDimensions',
    'designFootprint',
    'connections',
    'serviceClearance',
    'environmental',
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

  it('rejects an unknown verification status', () => {
    const record = validRecord();
    (record['serviceClearance'] as Record<string, unknown>)['verification'] = {
      ...draftVerification(),
      status: 'approved',
    };

    expect(issuePathsOf(record)).toContain('serviceClearance.verification.status');
  });

  it('rejects a group with no verification block at all', () => {
    const record = validRecord();
    delete (record['serviceClearance'] as Record<string, unknown>)['verification'];

    expect(issuePathsOf(record)).toContain('serviceClearance.verification');
  });

  it('refuses a verification block on the design footprint', () => {
    // It is an owner-defined planning property with no manufacturer citation. A
    // verification block there would be a record that two different things were meant.
    const record = validRecord();
    (record['designFootprint'] as Record<string, unknown>)['verification'] =
      verifiedVerification();

    expect(() => parse(record)).toThrow(CatalogValidationError);
  });

  it('rejects a non-semver version', () => {
    const record = validRecord();
    record['version'] = 'v1';

    expect(issuePathsOf(record)).toContain('version');
  });

  it('rejects a malformed date', () => {
    const record = validRecord();
    (record['environmental'] as Record<string, Record<string, unknown>>)['verification'] = {
      ...draftVerification(),
      source: { ...draftVerification().source, lastUpdated: '29/07/2026' },
    };

    expect(issuePathsOf(record)).toContain('environmental.verification.source.lastUpdated');
  });

  it('rejects an unknown key, so a misspelled field cannot be silently dropped', () => {
    const record = validRecord();
    record['dimension'] = { width: 900 };

    expect(() => parse(record)).toThrow(CatalogValidationError);
  });
});

describe('a verified group must carry its source', () => {
  /** Put a bare `verified` status on one group, with no citation behind it. */
  function claimVerified(group: string): Record<string, unknown> {
    const record = validRecord();
    (record[group] as Record<string, unknown>)['verification'] = {
      ...draftVerification(),
      status: 'verified',
    };
    return record;
  }

  it('rejects verified with no document, revision or section', () => {
    const paths = issuePathsOf(claimVerified('serviceClearance'));

    expect(paths).toContain('serviceClearance.verification.source.document');
    expect(paths).toContain('serviceClearance.verification.source.revision');
    expect(paths).toContain('serviceClearance.verification.source.section');
  });

  it.each(['document', 'revision', 'section'])(
    'rejects verified when only source.%s is missing',
    (field) => {
      const record = validRecord();
      const verification = verifiedVerification();
      (verification.source as Record<string, unknown>)[field] = null;
      (record['manufacturerDimensions'] as Record<string, unknown>)['verification'] =
        verification;

      expect(issuePathsOf(record)).toContain(
        `manufacturerDimensions.verification.source.${field}`,
      );
    },
  );

  it('names the group that failed, not just the field', () => {
    // Six groups can each be verified independently, so "source.revision is missing"
    // would send an engineer looking through all of them.
    const paths = issuePathsOf(claimVerified('environmental'));
    expect(paths.every((path) => path.startsWith('environmental.'))).toBe(true);
  });

  it('accepts verified once that group can cite itself', () => {
    const record = validRecord();
    (record['serviceClearance'] as Record<string, unknown>)['verification'] =
      verifiedVerification();

    expect(fieldStatus(parse(record), 'serviceClearance')).toBe('verified');
  });

  it('does not require a design footprint basis for a verified group', () => {
    // An earlier version did, which treated an owner planning decision as unsourced
    // data. The footprint has no citation by design and gates nothing.
    const record = validRecord();
    (record['designFootprint'] as Record<string, unknown>)['basis'] = null;
    (record['manufacturerDimensions'] as Record<string, unknown>)['verification'] =
      verifiedVerification('2.1 Dimensions');

    expect(fieldStatus(parse(record), 'manufacturerDimensions')).toBe('verified');
  });

  it('allows draft to omit its source, because that is what draft means', () => {
    const object = parse(validRecord());
    expect(fieldVerification(object, 'serviceClearance').source.document).toBeNull();
  });

  it('rejects an empty string standing in for a real reference', () => {
    const record = validRecord();
    const verification = verifiedVerification();
    (verification.source as Record<string, unknown>)['document'] = '';
    (record['serviceClearance'] as Record<string, unknown>)['verification'] = verification;

    expect(issuePathsOf(record)).toContain('serviceClearance.verification.source.document');
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
