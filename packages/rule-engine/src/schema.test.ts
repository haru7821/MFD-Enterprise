import { describe, expect, it } from 'vitest';

import { fixtureClearanceRule, fixtureCollisionRule } from '../fixtures/index';
import { RuleValidationError } from './errors';
import { parseRule } from './ruleSet';

function issuePathsOf(record: unknown): string[] {
  try {
    parseRule(record, 'test_rule.json');
  } catch (error) {
    if (error instanceof RuleValidationError) return error.issues.map((issue) => issue.path);
    throw error;
  }
  throw new Error('Expected the rule to be rejected, but it parsed successfully.');
}

describe('a valid rule', () => {
  it('parses a clearance rule', () => {
    const rule = parseRule(fixtureClearanceRule(), 'test_rule.json');

    expect(rule.category).toBe('clearance');
    expect(rule.threshold).toBe(1_200);
  });

  it('parses a collision rule', () => {
    const rule = parseRule(fixtureCollisionRule(), 'test_rule.json');

    expect(rule.category).toBe('collision');
    expect(rule.threshold).toBeNull();
  });

  it('accepts a null threshold, which defers to the equipment record', () => {
    const rule = parseRule(fixtureClearanceRule({ threshold: null }), 'test_rule.json');

    expect(rule.threshold).toBeNull();
  });
});

describe('missing fields are rejected', () => {
  it.each([
    'ruleId',
    'category',
    'description',
    'threshold',
    'unit',
    'status',
    'severity',
    'appliesTo',
    'parameters',
    'source',
  ])('rejects a rule with no "%s"', (field) => {
    const record = fixtureClearanceRule();
    delete record[field];

    // Removing the discriminator produces a union-level error rather than a
    // field-level one, so only assert that it fails.
    if (field === 'category') {
      expect(() => parseRule(record, 'test_rule.json')).toThrow(RuleValidationError);
      return;
    }
    expect(issuePathsOf(record)).toContain(field);
  });

  it('rejects a missing nested source field', () => {
    const record = fixtureClearanceRule();
    delete (record['source'] as Record<string, unknown>)['revision'];

    expect(issuePathsOf(record)).toContain('source.revision');
  });
});

describe('invalid values are rejected', () => {
  it('rejects an unknown category', () => {
    const record = fixtureClearanceRule();
    record['category'] = 'ventilation';

    expect(() => parseRule(record, 'test_rule.json')).toThrow(RuleValidationError);
  });

  it('rejects a non-snake-case ruleId', () => {
    expect(issuePathsOf(fixtureClearanceRule({ ruleId: 'AK98 Front' }))).toContain('ruleId');
  });

  it('rejects a zero or negative threshold', () => {
    for (const bad of [0, -1_200]) {
      const record = fixtureClearanceRule();
      record['threshold'] = bad;
      expect(issuePathsOf(record)).toContain('threshold');
    }
  });

  it('rejects a threshold that is a string', () => {
    const record = fixtureClearanceRule();
    record['threshold'] = '1200';

    expect(issuePathsOf(record)).toContain('threshold');
  });

  it('rejects an unknown clearance side', () => {
    const record = fixtureClearanceRule();
    record['parameters'] = { side: 'above' };

    expect(issuePathsOf(record)).toContain('parameters.side');
  });

  it('rejects an unknown status', () => {
    const record = fixtureClearanceRule();
    record['status'] = 'approved';

    expect(issuePathsOf(record)).toContain('status');
  });

  it('rejects a severity of GREEN — a violation is never a pass', () => {
    const record = fixtureClearanceRule();
    record['severity'] = 'GREEN';

    expect(issuePathsOf(record)).toContain('severity');
  });

  it('rejects an unknown key, so a misspelled field cannot be silently dropped', () => {
    const record = fixtureClearanceRule();
    record['treshold'] = 1_200;

    expect(() => parseRule(record, 'test_rule.json')).toThrow(RuleValidationError);
  });

  it('rejects a rule that selects nothing', () => {
    // A rule applying to no equipment produces no results, which is
    // indistinguishable from a rule that everything passes.
    const record = fixtureClearanceRule({ equipmentIds: null, categories: null });

    expect(() => parseRule(record, 'test_rule.json')).toThrow(RuleValidationError);
  });

  it('accepts a rule selecting by category alone', () => {
    const rule = parseRule(
      fixtureClearanceRule({ equipmentIds: null, categories: ['dialysis_machine'] }),
      'test_rule.json',
    );

    expect(rule.appliesTo.categories).toEqual(['dialysis_machine']);
  });
});

describe('verified rules must carry their source', () => {
  it.each(['document', 'revision', 'section'])(
    'rejects verified when source.%s is null',
    (field) => {
      const record = fixtureClearanceRule({ status: 'verified' });
      (record['source'] as Record<string, unknown>)[field] = null;

      expect(issuePathsOf(record)).toContain(`source.${field}`);
    },
  );

  it('accepts verified with a complete source', () => {
    const rule = parseRule(fixtureClearanceRule({ status: 'verified' }), 'test_rule.json');

    expect(rule.status).toBe('verified');
    expect(rule.source.revision).toBe('Rev. 1');
  });

  it('allows draft to omit its source, because that is what draft means', () => {
    const rule = parseRule(fixtureClearanceRule({ status: 'draft' }), 'test_rule.json');

    expect(rule.source.document).toBeNull();
  });
});

/**
 * Owner decision — AK98 source clarification, reaching the rule set.
 *
 * > *"Do not populate service clearance … from the equipment manual. Those values must come from:
 * > TS installation standards, hospital design standards, installation drawings, field validated
 * > data."*
 *
 * The catalogue enforces this on a record. A threshold, though, is the number the evaluator
 * actually compares against — so a clearance rule cited to the AK98 manual would produce exactly
 * the verdict the decision exists to prevent, with the catalogue's clearance still honestly null.
 */
describe('a cited clearance rule may only come from an installation standard', () => {
  function cited(type: string, category: 'clearance' | 'collision' = 'clearance') {
    const record =
      category === 'clearance'
        ? fixtureClearanceRule({ status: 'verified' })
        : fixtureCollisionRule({ status: 'verified' });
    (record['source'] as Record<string, unknown>)['type'] = type;
    return record;
  }

  it.each(['manufacturer_manual', 'datasheet', 'estimate', 'field_measurement'])(
    'rejects a clearance rule cited to "%s"',
    (type) => {
      expect(issuePathsOf(cited(type))).toContain('source.type');
    },
  );

  it.each([
    'ts_installation_standard',
    'hospital_design_standard',
    'installation_drawing',
    'field_validated',
  ])('accepts a clearance rule cited to "%s"', (type) => {
    // The permitted list has to work, or the rejections above would only prove that nothing is
    // citable at all.
    expect(() => parseRule(cited(type), 'test_rule.json')).not.toThrow();
  });

  it('leaves a draft clearance rule alone', () => {
    /*
     * Every clearance rule shipped today is draft with `estimate` and no document — it claims
     * nothing, so there is nothing to constrain. Constraining it anyway would make the shipped
     * standards unloadable and force somebody to invent a citation to get the build green, which
     * is the precise failure this whole rule exists to prevent.
     */
    const record = fixtureClearanceRule({ status: 'draft' });
    (record['source'] as Record<string, unknown>)['type'] = 'estimate';

    expect(() => parseRule(record, 'test_rule.json')).not.toThrow();
  });

  it('does not constrain a collision rule, which is not a clearance figure', () => {
    // An overlap check states no distance taken from any standard. Applying the installation-source
    // rule to it would be cargo cult: broader is not safer when it makes a true record unwritable.
    expect(() => parseRule(cited('manufacturer_manual', 'collision'), 'test_rule.json')).not.toThrow();
  });
});

describe('error reporting', () => {
  it('names the file and the field', () => {
    const record = fixtureClearanceRule();
    record['threshold'] = -5;

    try {
      parseRule(record, 'broken_rule.json');
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(RuleValidationError);
      expect((error as RuleValidationError).message).toContain('broken_rule.json');
      expect((error as RuleValidationError).message).toContain('threshold');
    }
  });
});

describe('the boundary collision scope', () => {
  it('is accepted by the schema even though no evaluator implements it', () => {
    // Reserved now so a Sprint 4 rule file needs no schema change.
    const rule = parseRule(fixtureCollisionRule({ scope: 'boundary' }), 'test_rule.json');

    expect(rule.category).toBe('collision');
  });
});
