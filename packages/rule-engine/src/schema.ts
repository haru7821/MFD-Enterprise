import { z } from 'zod';

import type { Bilingual } from './messages';

/**
 * Rule record schema.
 *
 * Implements docs/rules/DIALYSIS_RULE_ENGINE_v0.1.md. The specification's design
 * principle is the whole point of this file:
 *
 *   Incorrect:  if (distance < 1200)
 *   Correct:    load rule → validate → generate result
 *
 * No engineering threshold appears anywhere in this package's code. Every number an
 * evaluator compares against arrives from a JSON record or from an equipment
 * catalogue entry, and every result records which.
 *
 * Field discipline matches the equipment catalogue: fields are required and
 * nullable rather than optional, and unknown keys are rejected. Forgetting a field
 * must not look like recording that its value is unknown.
 */

const finiteNumber = z.number().refine(Number.isFinite, 'must be a finite number');
const millimetres = finiteNumber.refine((value) => value > 0, 'must be greater than zero');

export const RULE_CATEGORIES = ['clearance', 'collision'] as const;
export const RULE_STATUSES = ['draft', 'verified'] as const;
export const RESULT_LEVELS = ['GREEN', 'YELLOW', 'RED'] as const;
export const CLEARANCE_SIDES = ['front', 'rear', 'left', 'right'] as const;
export const SOURCE_TYPES = [
  'manufacturer_manual',
  'datasheet',
  'field_measurement',
  'estimate',
] as const;

/**
 * Collision scope.
 *
 * `boundary` is declared here but has no evaluator in Sprint 3 — walls arrive with
 * the spatial model in Sprint 4. Reserving the value now means the rule files
 * written then need no schema change.
 */
export const COLLISION_SCOPES = ['equipment', 'boundary'] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];
export type RuleStatus = (typeof RULE_STATUSES)[number];
export type ResultLevel = (typeof RESULT_LEVELS)[number];
export type ClearanceSide = (typeof CLEARANCE_SIDES)[number];
export type CollisionScope = (typeof COLLISION_SCOPES)[number];

/**
 * Where a rule's numbers came from.
 *
 * TS Edition specification section 6: "Every rule requires source information."
 * A rule claiming `verified` must name its document, revision and section —
 * enforced below.
 */
export const ruleSourceSchema = z.strictObject({
  document: z.string().min(1).nullable(),
  /** A threshold is true *at a revision*, not in general. */
  revision: z.string().min(1).nullable(),
  section: z.string().min(1).nullable(),
  type: z.enum(SOURCE_TYPES),
  lastUpdated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)'),
});

/**
 * Which placements a rule governs.
 *
 * At least one selector must be present, otherwise a rule silently applies to
 * nothing and looks like it is passing.
 */
export const appliesToSchema = z
  .strictObject({
    equipmentIds: z.array(z.string().min(1)).min(1).nullable(),
    categories: z.array(z.string().min(1)).min(1).nullable(),
  })
  .refine(
    (value) => value.equipmentIds !== null || value.categories !== null,
    'appliesTo needs equipmentIds or categories; a rule that selects nothing looks like a rule that passes',
  );

/**
 * A phrase in both languages.
 *
 * Rule wording lives **in the rule file**, not in the report generator. A rule's name is
 * part of the rule — it is what the report prints beside the verdict and what an engineer
 * quotes to a customer — so it belongs with the threshold and the citation, under AD-4's
 * "`standards/` is the source of record". A generator holding its own list of rule names
 * would let the two drift, and the drift would show up in a signed document.
 *
 * Both languages required: a rule with one is a rule the bilingual report cannot print.
 */
export const bilingualSchema: z.ZodType<Bilingual> = z.strictObject({
  ko: z.string().min(1),
  en: z.string().min(1),
});

const baseRuleFields = {
  ruleId: z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'must be lower_snake_case'),
  /** Short title for a table row — "전면 정비 공간 / Front Service Clearance". */
  name: bilingualSchema,
  /** The full statement of the requirement. */
  description: bilingualSchema,
  /**
   * The rule's own threshold, or null to defer to the equipment record.
   * Null is not "no requirement" — it is "this rule does not set the number".
   */
  threshold: millimetres.nullable(),
  unit: z.enum(['mm']),
  status: z.enum(RULE_STATUSES),
  /**
   * The level a violation produces. Without this every finding is equally urgent,
   * which gives a TS engineer no way to triage a page of results.
   */
  severity: z.enum(['RED', 'YELLOW']),
  appliesTo: appliesToSchema,
  source: ruleSourceSchema,
};

export const clearanceRuleSchema = z.strictObject({
  ...baseRuleFields,
  category: z.literal('clearance'),
  parameters: z.strictObject({ side: z.enum(CLEARANCE_SIDES) }),
});

export const collisionRuleSchema = z.strictObject({
  ...baseRuleFields,
  category: z.literal('collision'),
  parameters: z.strictObject({ scope: z.enum(COLLISION_SCOPES) }),
});

function requireSourceWhenVerified(
  rule: { status: RuleStatus; source: z.infer<typeof ruleSourceSchema> },
  ctx: z.RefinementCtx,
): void {
  if (rule.status !== 'verified') return;

  for (const field of ['document', 'revision', 'section'] as const) {
    if (rule.source[field] === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['source', field],
        message: `status "verified" requires source.${field}; use "draft" until the manual reference is known`,
      });
    }
  }
}

export const ruleSchema = z
  .discriminatedUnion('category', [clearanceRuleSchema, collisionRuleSchema])
  .superRefine(requireSourceWhenVerified);

export type ClearanceRule = z.infer<typeof clearanceRuleSchema>;
export type CollisionRule = z.infer<typeof collisionRuleSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type RuleSource = z.infer<typeof ruleSourceSchema>;

export function isClearanceRule(rule: Rule): rule is ClearanceRule {
  return rule.category === 'clearance';
}

export function isCollisionRule(rule: Rule): rule is CollisionRule {
  return rule.category === 'collision';
}
