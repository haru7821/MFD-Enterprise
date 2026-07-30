import type { ReferencePointKind } from '@mfd/document-model';

/**
 * Short forms for the canvas and the properties panel, where space is scarce.
 *
 * English rather than bilingual: this is editor chrome, and assumption C-4 records that the
 * interface is English while the **report** is bilingual. The report's labels come from the
 * report engine's own catalogue and carry both languages, which is why these are not shared with
 * it — two audiences, two vocabularies, and neither should be forced through the other's.
 *
 * A `Record` over the kind union, so adding a kind fails to compile rather than rendering blank.
 */
export const REFERENCE_POINT_LABELS: Record<ReferencePointKind, string> = {
  ro_supply: 'RO supply',
  ro_return: 'RO return',
  drain: 'Drain',
  electrical_panel: 'Panel',
  data: 'Data',
  access_entry: 'Access',
  staff_base: 'Staff base',
};

/** The order the picker offers them in: services, then circulation. */
export const REFERENCE_POINT_ORDER: readonly ReferencePointKind[] = [
  'ro_supply',
  'ro_return',
  'drain',
  'electrical_panel',
  'data',
  'access_entry',
  'staff_base',
];
