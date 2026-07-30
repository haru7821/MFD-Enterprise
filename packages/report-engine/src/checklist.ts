import type { EvaluationReport, EvaluationResult } from '@mfd/rule-engine';
import {
  VERIFIED_FIELD_GROUPS,
  type EquipmentObject,
  fieldVerification,
} from '@mfd/object-library';

import type { ChecklistTemplate } from './checklistTemplate';
import { FIELD_GROUP_KEYS } from './groups';
import type { ChecklistCategory, ChecklistItem, ChecklistSection } from './model';

/**
 * Section 6 — the installation checklist.
 *
 * Two halves, and both are necessary:
 *
 * | Half | Source | Why |
 * | --- | --- | --- |
 * | Standing items | `standards/checklists/dialysis.json` | The owner's six categories. Commissioning steps exist whether or not this drawing turned anything up. |
 * | Derived items | The findings and the data gaps | A generic checklist that ignores what the drawing shows is a form, not an engineering output. |
 *
 * A checklist of only standing items ignores the assessment. A checklist of only derived
 * items is **empty on a drawing with no equipment placed** — and an engineer still has a
 * water loop to commission. So they interleave, in the same categories, and an engineer
 * works through one list.
 *
 * ## Where a derived item lands
 *
 * By what the finding is about, not by rule id:
 *
 * | Finding | Category |
 * | --- | --- |
 * | Clearance, collision, boundary | `accessibility` — they are all "can you get to it and does it fit" |
 * | A draft electrical / RO / drain group | `electrical` · `ro_water` · `drain` |
 * | An uncalibrated level | `final_engineer_check` |
 *
 * Clearance findings under accessibility rather than a category of their own: a clearance
 * violation *is* an access problem, and inventing a seventh category the owner did not ask
 * for would put the derived items somewhere an engineer is not looking.
 */

/** Which category a draft field group's item belongs in. */
const GROUP_CATEGORY: Readonly<Record<string, string>> = {
  power: 'electrical',
  roWater: 'ro_water',
  drain: 'drain',
  manufacturerDimensions: 'final_engineer_check',
  serviceClearance: 'accessibility',
  environmental: 'final_engineer_check',
};

const GEOMETRY_CATEGORY = 'accessibility';
const FALLBACK_CATEGORY = 'final_engineer_check';

export interface ChecklistInputs {
  readonly template: ChecklistTemplate;
  readonly reports: readonly EvaluationReport[];
  readonly equipmentInUse: readonly EquipmentObject[];
  readonly uncalibratedLevelNames: readonly string[];
}

/** An action for a finding, from its level. RED must be resolved; YELLOW confirmed. */
function actionFor(result: EvaluationResult): ChecklistItem['action'] {
  return result.level === 'RED' ? 'action_resolve' : 'action_confirm_on_site';
}

function derivedFromFindings(reports: readonly EvaluationReport[]): Map<string, ChecklistItem[]> {
  const byCategory = new Map<string, ChecklistItem[]>();

  for (const report of reports) {
    for (const result of report.results) {
      // GREEN needs no action. A checklist item per satisfied requirement would bury the
      // three things that actually need doing under forty that do not.
      if (result.level === 'GREEN') continue;

      const category = GEOMETRY_CATEGORY;
      const items = byCategory.get(category) ?? [];
      items.push({
        origin: 'finding',
        reasonCode: result.reasonCode,
        reasonParams: result.reasonParams,
        text: null,
        action: actionFor(result),
        ruleId: result.ruleId,
        placementLabel: result.placementIds.length > 0 ? result.placementIds[0] ?? null : null,
      });
      byCategory.set(category, items);
    }
  }

  return byCategory;
}

function derivedFromDataGaps(
  equipmentInUse: readonly EquipmentObject[],
): Map<string, ChecklistItem[]> {
  const byCategory = new Map<string, ChecklistItem[]>();

  for (const object of equipmentInUse) {
    for (const group of VERIFIED_FIELD_GROUPS) {
      if (fieldVerification(object, group).status === 'verified') continue;

      const category = GROUP_CATEGORY[group] ?? FALLBACK_CATEGORY;
      const items = byCategory.get(category) ?? [];
      items.push({
        origin: 'data_gap',
        reasonCode: null,
        reasonParams: {},
        // One item per **group**, not per record. A record with five groups sourced must
        // not read as wholly unverified — that is the record-level behaviour the owner
        // replaced, and it would reappear here if this were one item per machine.
        text: {
          ko: `${object.model}의 ${FIELD_GROUP_KEYS[group].ko} 자료를 제조사 공식 문서로 확보`,
          en: `Obtain ${object.model} ${FIELD_GROUP_KEYS[group].en.toLowerCase()} from manufacturer documentation`,
        },
        action: 'action_obtain_manual',
        ruleId: null,
        placementLabel: null,
      });
      byCategory.set(category, items);
    }
  }

  return byCategory;
}

function derivedFromCalibration(levelNames: readonly string[]): ChecklistItem[] {
  return levelNames.map((name) => ({
    origin: 'calibration' as const,
    reasonCode: null,
    reasonParams: {},
    text: {
      ko: `${name} 도면의 축척을 설정한 뒤 해당 층의 치수를 재확인`,
      en: `Calibrate the ${name} drawing and re-check every dimension on that level`,
    },
    action: 'action_calibrate' as const,
    ruleId: null,
    placementLabel: null,
  }));
}

/**
 * Move items whose category the template does not have into one it does.
 *
 * The template is customer-editable data, so it may not carry all six categories — and a
 * derived item assigned to a missing one would otherwise be **silently dropped**. That is
 * the worst possible failure for this section: "obtain the drain specification from the
 * manufacturer" disappearing because a site's template has no Drain heading, with nothing
 * anywhere saying so.
 *
 * Found by a test using a three-category fixture template, which lost two of the six
 * data-gap items. Now they land in the fallback category, which every template ends up
 * having because it is the last resort rather than a named requirement.
 */
function reachable(
  byCategory: Map<string, ChecklistItem[]>,
  templateIds: readonly string[],
): Map<string, ChecklistItem[]> {
  const fallback = templateIds.includes(FALLBACK_CATEGORY)
    ? FALLBACK_CATEGORY
    : (templateIds[templateIds.length - 1] ?? FALLBACK_CATEGORY);

  const moved = new Map<string, ChecklistItem[]>();
  for (const [category, items] of byCategory) {
    const target = templateIds.includes(category) ? category : fallback;
    moved.set(target, [...(moved.get(target) ?? []), ...items]);
  }
  return moved;
}

export function buildChecklist({
  template,
  reports,
  equipmentInUse,
  uncalibratedLevelNames,
}: ChecklistInputs): ChecklistSection {
  const templateIds = template.categories.map((category) => category.id);

  const fromFindings = reachable(derivedFromFindings(reports), templateIds);
  const fromGaps = reachable(derivedFromDataGaps(equipmentInUse), templateIds);
  const fromCalibration = derivedFromCalibration(uncalibratedLevelNames);
  const calibrationCategory = templateIds.includes(FALLBACK_CATEGORY)
    ? FALLBACK_CATEGORY
    : (templateIds[templateIds.length - 1] ?? FALLBACK_CATEGORY);

  const categories: ChecklistCategory[] = template.categories.map((category) => {
    const standing: ChecklistItem[] = category.items.map((item) => ({
      origin: 'standard',
      reasonCode: null,
      reasonParams: {},
      text: item.text,
      action: 'action_check',
      ruleId: null,
      placementLabel: null,
    }));

    // Derived first. An item this drawing produced outranks a standing step, because it is
    // the thing a reader did not already know.
    const derived = [
      ...(fromFindings.get(category.id) ?? []),
      ...(fromGaps.get(category.id) ?? []),
      ...(category.id === calibrationCategory ? fromCalibration : []),
    ];

    return { id: category.id, title: category.title, items: [...derived, ...standing] };
  });

  return { categories };
}
