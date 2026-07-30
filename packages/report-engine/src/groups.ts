import { VERIFIED_FIELD_GROUPS, type VerifiedFieldGroup } from '@mfd/object-library';
import type { Bilingual } from '@mfd/rule-engine';

import { LABELS, type LabelKey } from './labels';

/**
 * Field groups, bilingual, keyed by the group name the catalogue uses.
 *
 * Two small functions, and the reason for both is the same: a group added to
 * `@mfd/object-library` must break the build here rather than silently vanish from a
 * heading in a PDF.
 *
 * `FIELD_GROUP_KEYS` is checked at module load rather than by types alone, because the
 * mapping is name-based (`group_${group}`) and a typed template literal cannot tell you
 * *which* key is missing from `LABELS` — only that one is. An engineer reading a stack trace
 * at build time wants the name.
 */

/** `group_serviceClearance`, etc. Throws at load if the label is missing. */
export function groupLabelKey(group: VerifiedFieldGroup): LabelKey {
  const key = `group_${group}`;
  if (!(key in LABELS)) {
    throw new Error(
      `no bilingual label for equipment field group "${group}" — add "${key}" to labels.ts`,
    );
  }
  return key as LabelKey;
}

/** Every group's bilingual wording, resolved once. */
export const FIELD_GROUP_KEYS: Readonly<Record<VerifiedFieldGroup, Bilingual>> =
  Object.fromEntries(
    VERIFIED_FIELD_GROUPS.map((group) => [group, LABELS[groupLabelKey(group)]]),
  ) as Record<VerifiedFieldGroup, Bilingual>;
