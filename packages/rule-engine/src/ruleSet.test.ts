import { describe, expect, it } from 'vitest';

import { fixtureClearanceRule, fixtureCollisionRule } from '../fixtures/index';
import { dialysisRuleSet } from '../rules/index';
import { DuplicateRuleIdError, RuleValidationError } from './errors';
import { createRuleSet } from './ruleSet';

function set(records: readonly Record<string, unknown>[]) {
  return createRuleSet(
    records.map((raw, index) => ({ fileName: `rule_${index}.json`, raw })),
    { id: 'test', version: '0.0.1' },
  );
}

describe('createRuleSet', () => {
  it('indexes rules by id', () => {
    const ruleSet = set([fixtureClearanceRule(), fixtureCollisionRule()]);

    expect(ruleSet.rules).toHaveLength(2);
    expect(ruleSet.get('fixture_front_clearance')?.category).toBe('clearance');
    expect(ruleSet.get('nope')).toBeUndefined();
  });

  it('accepts a file holding an array of rules', () => {
    const ruleSet = createRuleSet(
      [
        {
          fileName: 'many.json',
          raw: [
            fixtureClearanceRule({ ruleId: 'a_rule' }),
            fixtureClearanceRule({ ruleId: 'b_rule' }),
          ],
        },
      ],
      { id: 'test', version: '0.0.1' },
    );

    expect(ruleSet.rules).toHaveLength(2);
  });

  it('refuses to load when any rule is invalid', () => {
    // Dropping the bad rule would produce a report silently missing a
    // requirement, with nothing anywhere saying so.
    const bad = fixtureClearanceRule();
    bad['threshold'] = -1;

    expect(() => set([fixtureClearanceRule({ ruleId: 'good_rule' }), bad])).toThrow(
      RuleValidationError,
    );
  });

  it('names the offending file', () => {
    const bad = fixtureClearanceRule();
    bad['status'] = 'maybe';

    try {
      createRuleSet([{ fileName: 'broken.json', raw: bad }], { id: 't', version: '1' });
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as RuleValidationError).fileName).toBe('broken.json');
    }
  });

  it('rejects duplicate rule ids', () => {
    // Results are keyed by rule id, so a duplicate would shadow the first record
    // and a requirement would vanish from the report without anything failing.
    expect(() =>
      set([
        fixtureClearanceRule({ ruleId: 'same_id' }),
        fixtureClearanceRule({ ruleId: 'same_id', side: 'rear' }),
      ]),
    ).toThrow(DuplicateRuleIdError);
  });

  it('names both files holding the duplicate', () => {
    try {
      set([
        fixtureClearanceRule({ ruleId: 'same_id' }),
        fixtureClearanceRule({ ruleId: 'same_id' }),
      ]);
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as DuplicateRuleIdError).fileNames).toEqual([
        'rule_0.json',
        'rule_1.json',
      ]);
    }
  });

  it('lists draft rules separately', () => {
    const ruleSet = set([
      fixtureClearanceRule({ ruleId: 'draft_rule', status: 'draft' }),
      fixtureClearanceRule({ ruleId: 'verified_rule', status: 'verified' }),
    ]);

    expect(ruleSet.draftRules.map((rule) => rule.ruleId)).toEqual(['draft_rule']);
  });

  it('carries its identity for stamping into reports', () => {
    const ruleSet = set([fixtureClearanceRule()]);

    expect(ruleSet.id).toBe('test');
    expect(ruleSet.version).toBe('0.0.1');
  });
});

describe('the shipped dialysis rule set', () => {
  it('loads', () => {
    expect(dialysisRuleSet.rules.length).toBeGreaterThan(0);
    expect(dialysisRuleSet.id).toBe('dialysis');
  });

  it('invents no engineering thresholds', () => {
    // The AK98 manual has not been supplied. A figure here would be a guess
    // presented as a requirement.
    for (const rule of dialysisRuleSet.rules) {
      expect(rule.threshold).toBeNull();
    }
  });

  it('marks every shipped rule as draft with no source document', () => {
    for (const rule of dialysisRuleSet.rules) {
      expect(rule.status).toBe('draft');
      expect(rule.source.document).toBeNull();
    }
    expect(dialysisRuleSet.draftRules).toHaveLength(dialysisRuleSet.rules.length);
  });

  it('covers all four clearance sides and equipment collision', () => {
    const sides = dialysisRuleSet.rules
      .filter((rule) => rule.category === 'clearance')
      .map((rule) => (rule.category === 'clearance' ? rule.parameters.side : null))
      .sort();

    expect(sides).toEqual(['front', 'left', 'rear', 'right']);
    expect(dialysisRuleSet.rules.some((rule) => rule.category === 'collision')).toBe(true);
  });
});
