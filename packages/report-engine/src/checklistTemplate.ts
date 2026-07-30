import { z } from 'zod';

/**
 * The installation checklist template — **data, not code**.
 *
 * Owner decision: the checklist covers Electrical, RO Water, Drain, Network,
 * Accessibility and Final Engineer Check. Those are engineering process items, so under
 * AD-4 and CLAUDE.md's "never hard-code engineering rules" they live in
 * `standards/checklists/`, versioned in git and loaded at runtime.
 *
 * The distinction that matters: a category list compiled into this package would make
 * "add a commissioning step" a code change and a release. As data it is a pull request
 * against a JSON file that a TS engineer can read.
 *
 * ## Why the standing items are not derived from findings
 *
 * The derived items — resolve this RED, confirm that YELLOW on site, obtain the missing
 * manual — are generated in ./checklist.ts from the evaluation. They are not enough on
 * their own: a drawing with no equipment placed produces no findings, and a checklist
 * that is therefore empty tells an engineer nothing about the water loop they still have
 * to commission.
 *
 * So the checklist is both: the template's standing items **plus** whatever the drawing
 * turned up, in the same categories, so an engineer works through one list.
 */

const bilingualSchema = z.strictObject({
  ko: z.string().min(1),
  en: z.string().min(1),
});

const templateItemSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'must be lower_snake_case'),
  text: bilingualSchema,
});

const templateCategorySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'must be lower_snake_case'),
  title: bilingualSchema,
  items: z.array(templateItemSchema),
});

export const checklistTemplateSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  categories: z.array(templateCategorySchema).min(1),
});

export type ChecklistTemplate = z.infer<typeof checklistTemplateSchema>;
export type ChecklistTemplateCategory = z.infer<typeof templateCategorySchema>;

export class ChecklistTemplateError extends Error {
  constructor(
    readonly fileName: string,
    readonly issues: readonly string[],
  ) {
    super(`${fileName} is not a valid checklist template:\n  ${issues.join('\n  ')}`);
    this.name = 'ChecklistTemplateError';
  }
}

/**
 * Validate a template, naming every bad field.
 *
 * Same discipline as the rule and catalogue loaders: a malformed file fails loudly at load
 * rather than producing a report with a category quietly missing. A checklist an engineer
 * signs is not a place to discover that a JSON key was misspelled.
 */
export function parseChecklistTemplate(fileName: string, raw: unknown): ChecklistTemplate {
  const result = checklistTemplateSchema.safeParse(raw);
  if (result.success) return result.data;

  throw new ChecklistTemplateError(
    fileName,
    result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  );
}
