import { type RuleSet, createRuleSet } from '../src/ruleSet';

import clearanceRules from '../../../standards/rules/dialysis/equipment_clearance.json';
import collisionRules from '../../../standards/rules/dialysis/equipment_collision.json';

/**
 * The shipped dialysis rule set.
 *
 * Loaded from `standards/rules/`, the location CLAUDE.md specifies. Records are
 * imported statically so a bundler sees every file and validation runs at module
 * load: a malformed rule fails when the application starts, not the first time an
 * engineer places the machine it governs.
 *
 * ## Every threshold here is null
 *
 * That is deliberate, and it is not an oversight to be tidied up later. The AK98
 * installation manual has not been supplied, so there is no clearance figure that
 * is true. A number invented to make the demo look complete would be
 * indistinguishable from a real one the moment it reached a report.
 *
 * The consequence is visible in the running application: every clearance result
 * reads YELLOW, "threshold unknown". That is the correct behaviour of a validator
 * that has nothing to validate against, and it resolves the instant real figures
 * arrive — edit the JSON, set `status` to `verified`, fill in `source`, and GREEN
 * becomes reachable with no code change.
 *
 * Figures used to *test* the evaluators live in `../fixtures/`, deliberately apart
 * from this path.
 */
export const dialysisRuleSet: RuleSet = createRuleSet(
  [
    { fileName: 'standards/rules/dialysis/equipment_clearance.json', raw: clearanceRules },
    { fileName: 'standards/rules/dialysis/equipment_collision.json', raw: collisionRules },
  ],
  { id: 'dialysis', version: '0.1.0' },
);

export { type RuleSet };
