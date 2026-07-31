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
 * Separate from {@link verifiedVerification} because the schema leaves no choice: an installation
 * group's source vocabulary contains no manufacturer document, so the citation that verifies a
 * dimension cannot verify a clearance.
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

import { CatalogValidationError } from './errors';
import { parseEquipmentObject } from './catalog';
import {
  FIELD_GROUP_ORIGIN,
  INSTALLATION_FIELD_GROUPS,
  SPECIFICATION_FIELD_GROUPS,
  VERIFIED_FIELD_GROUPS,
  type EquipmentObject,
  fieldStatus,
  fieldVerification,
  groupsWithStatus,
  hasDraftFields,
  isFullyVerified,
  isSourced,
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
      planningFootprint: { width: 900, depth: 750, basis: null },
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
    expect(object.planningFootprint.width).toBe(900);
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
    for (const group of VERIFIED_FIELD_GROUPS) {
      const cited =
        FIELD_GROUP_ORIGIN[group] === 'installation'
          ? verifiedInstallationVerification()
          : verifiedVerification();

      if (group === 'power' || group === 'roWater' || group === 'drain') {
        (record['connections'] as Record<string, Record<string, unknown>>)[group]!['verification'] =
          cited;
      } else {
        (record[group] as Record<string, unknown>)['verification'] = cited;
      }
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
    'planningFootprint',
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
    (record['planningFootprint'] as Record<string, unknown>)['width'] = '900';

    expect(issuePathsOf(record)).toContain('planningFootprint.width');
  });

  it('rejects a zero or negative footprint', () => {
    for (const bad of [0, -900]) {
      const record = validRecord();
      (record['planningFootprint'] as Record<string, unknown>)['width'] = bad;

      expect(issuePathsOf(record)).toContain('planningFootprint.width');
    }
  });

  it('rejects a non-finite length', () => {
    const record = validRecord();
    (record['planningFootprint'] as Record<string, unknown>)['depth'] = Number.POSITIVE_INFINITY;

    expect(issuePathsOf(record)).toContain('planningFootprint.depth');
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
    (record['planningFootprint'] as Record<string, unknown>)['verification'] =
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
      verifiedInstallationVerification();

    expect(fieldStatus(parse(record), 'serviceClearance')).toBe('verified');
  });

  it('does not require a design footprint basis for a verified group', () => {
    // An earlier version did, which treated an owner planning decision as unsourced
    // data. The footprint has no citation by design and gates nothing.
    const record = validRecord();
    (record['planningFootprint'] as Record<string, unknown>)['basis'] = null;
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
    (record['planningFootprint'] as Record<string, unknown>)['width'] = -1;
    record['category'] = 'nope';

    try {
      parse(record);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogValidationError);
      const message = (error as CatalogValidationError).message;

      expect(message).toContain('test_record.json');
      expect(message).toContain('planningFootprint.width');
      expect(message).toContain('category');
    }
  });
});

/**
 * Owner decision — AK98 source clarification.
 *
 * > *"Do not populate: service clearance, maintenance access, RO port location, drain location,
 * > installation routing — from the equipment manual. Those values must come from: TS installation
 * > standards, hospital design standards, installation drawings, field validated data."*
 * >
 * > *"Update the data model so equipment specification and installation requirements are
 * > independent sources."*
 *
 * These are the tests that make the sentence load-bearing. Every one of them fails if the two
 * source vocabularies are merged back into one, which is the single change that would quietly undo
 * the decision.
 */
describe('specification and installation are independent sources', () => {
  function citing(group: string, source: Record<string, unknown>): Record<string, unknown> {
    const record = validRecord();
    (record[group] as Record<string, unknown>)['verification'] = {
      status: 'verified',
      source: { document: 'D', revision: 'R', section: 'S', lastUpdated: '2026-07-31', ...source },
    };
    return record;
  }

  it.each(['serviceClearance', 'maintenanceAccess', 'portLocations', 'installationRouting'])(
    'refuses to let %s cite the equipment manual',
    (group) => {
      // The decision itself. Not a lint rule, not a review checklist — the record does not parse.
      expect(issuePathsOf(citing(group, { type: 'manufacturer_manual' }))).toContain(
        `${group}.verification.source.type`,
      );
    },
  );

  it.each(['serviceClearance', 'maintenanceAccess', 'portLocations', 'installationRouting'])(
    'refuses to let %s cite the datasheet either',
    (group) => {
      // The manual is the one the owner named; the datasheet is the same document class from the
      // same authority, and admitting it would reopen the door the decision closed.
      expect(issuePathsOf(citing(group, { type: 'datasheet' }))).toContain(
        `${group}.verification.source.type`,
      );
    },
  );

  it.each(['serviceClearance', 'maintenanceAccess', 'portLocations', 'installationRouting'])(
    'accepts %s cited to a TS installation standard',
    (group) => {
      // The other half: the permitted sources have to actually work, or the rule above would only
      // be proving that nothing can be cited at all.
      expect(() => parse(citing(group, { type: 'ts_installation_standard' }))).not.toThrow();
    },
  );

  it('accepts every source the owner named for an installation requirement', () => {
    for (const type of [
      'ts_installation_standard',
      'hospital_design_standard',
      'installation_drawing',
      'field_validated',
    ]) {
      expect(() => parse(citing('serviceClearance', { type })), type).not.toThrow();
    }
  });

  it('refuses to let a manufacturer dimension cite an installation standard', () => {
    // Independence runs both ways. A TS standard does not state what the machine measures, and a
    // record claiming it did would be citing a document that says no such thing.
    expect(issuePathsOf(citing('manufacturerDimensions', { type: 'ts_installation_standard' })))
      .toContain('manufacturerDimensions.verification.source.type');
  });

  it('classifies every group as one side or the other, with no overlap', () => {
    // The lists are what `FIELD_GROUP_ORIGIN` and the report's grouping read. A group in both or
    // in neither would be a field with no declared provenance.
    const specification = new Set<string>(SPECIFICATION_FIELD_GROUPS);
    const installation = new Set<string>(INSTALLATION_FIELD_GROUPS);

    for (const group of VERIFIED_FIELD_GROUPS) {
      expect(specification.has(group) !== installation.has(group), group).toBe(true);
      expect(FIELD_GROUP_ORIGIN[group], group).toBe(
        specification.has(group) ? 'specification' : 'installation',
      );
    }
    expect(specification.size + installation.size).toBe(VERIFIED_FIELD_GROUPS.length);
  });

  it('names the four groups the owner listed as installation data', () => {
    // Spelled out rather than derived, because this list *is* the decision — deriving it from the
    // code would make the test agree with whatever the code happened to say.
    expect([...INSTALLATION_FIELD_GROUPS].sort()).toEqual([
      'installationRouting',
      'maintenanceAccess',
      'portLocations',
      'serviceClearance',
    ]);
  });
});

describe('datasheet_verified', () => {
  function withStatus(
    group: string,
    status: string,
    source: Record<string, unknown>,
  ): Record<string, unknown> {
    const record = validRecord();
    (record[group] as Record<string, unknown>)['verification'] = {
      status,
      source: { document: 'D', revision: 'R', section: 'S', lastUpdated: '2026-07-31', ...source },
    };
    return record;
  }

  it('is accepted on a specification group cited to a datasheet', () => {
    // The owner's status for the AK98's dimensions, weight, electrical, water and environmental
    // figures once the datasheet reference is supplied.
    expect(() =>
      parse(withStatus('manufacturerDimensions', 'datasheet_verified', { type: 'datasheet' })),
    ).not.toThrow();
  });

  it('demands a document, a revision and a section like any other citation', () => {
    // Otherwise it would be a softer `verified` that anybody could set — which is exactly what a
    // status meaning "we got it off the datasheet, roughly" would become.
    for (const field of ['document', 'revision', 'section']) {
      const record = withStatus('manufacturerDimensions', 'datasheet_verified', {
        type: 'datasheet',
        [field]: null,
      });
      expect(issuePathsOf(record), field).toContain(
        `manufacturerDimensions.verification.source.${field}`,
      );
    }
  });

  it('refuses to be claimed over a source that is not a datasheet', () => {
    // The status names the document class it came from, so a manual-sourced group cannot wear it.
    expect(
      issuePathsOf(
        withStatus('manufacturerDimensions', 'datasheet_verified', { type: 'manufacturer_manual' }),
      ),
    ).toContain('manufacturerDimensions.verification.source.type');
  });

  it('is unreachable for an installation group, by construction', () => {
    /*
     * Two independent refusals meet here: the status requires `type: "datasheet"`, and an
     * installation group's vocabulary has no such member. There is no source value that satisfies
     * both, so no service clearance can ever be datasheet-verified — which is the owner's decision
     * expressed as an impossibility rather than a prohibition.
     */
    for (const type of ['datasheet', 'ts_installation_standard']) {
      expect(() => parse(withStatus('serviceClearance', 'datasheet_verified', { type })), type)
        .toThrow(CatalogValidationError);
    }
  });

  it('counts as sourced, not as a draft', () => {
    // `isSourced`, the predicate that replaced `=== 'verified'`. If this were wrong the report
    // would file a cited datasheet figure under "draft data" and an engineer would go chasing a
    // citation that already exists.
    const object = parse(
      withStatus('manufacturerDimensions', 'datasheet_verified', { type: 'datasheet' }),
    );

    expect(isSourced(fieldStatus(object, 'manufacturerDimensions'))).toBe(true);
    expect(groupsWithStatus(object, 'draft')).not.toContain('manufacturerDimensions');
    expect(isSourced('draft')).toBe(false);
  });
});

describe('the planning footprint stands apart from the manufacturer dimension', () => {
  it('is a separate field that no manufacturer figure feeds', () => {
    /*
     * > *"Equipment dimensions: manufacturer data와 planning footprint를 분리 유지. Planning
     * > footprint는 설치 검토용이며 manufacturer dimension을 대체하지 않는다."*
     *
     * The AK98 is the case in point: 585 × 620 as built, planned at 800 × 800. A record that
     * derived one from the other would lose the ability to check a delivery against the manual.
     */
    const record = validRecord();
    (record['manufacturerDimensions'] as Record<string, unknown>)['width'] = 585;
    (record['manufacturerDimensions'] as Record<string, unknown>)['depth'] = 620;
    (record['planningFootprint'] as Record<string, unknown>)['width'] = 800;
    (record['planningFootprint'] as Record<string, unknown>)['depth'] = 800;

    const object = parse(record);

    expect(object.manufacturerDimensions.width).toBe(585);
    expect(object.planningFootprint.width).toBe(800);
    expect(object.planningFootprint).not.toHaveProperty('verification');
  });

  it('is required, while every manufacturer figure may be unknown', () => {
    // A generic planning object — the dialysis bed — has a footprint and no manufacturer at all.
    const record = validRecord();
    for (const field of ['width', 'depth', 'height', 'weight']) {
      (record['manufacturerDimensions'] as Record<string, unknown>)[field] = null;
    }
    expect(() => parse(record)).not.toThrow();

    delete (record['planningFootprint'] as Record<string, unknown>)['width'];
    expect(issuePathsOf(record)).toContain('planningFootprint.width');
  });
});
