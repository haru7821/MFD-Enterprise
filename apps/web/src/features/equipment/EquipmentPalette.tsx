import {
  type EquipmentObject,
  type FieldVerification,
  VERIFIED_FIELD_GROUPS,
  type VerifiedFieldGroup,
  fieldVerification,
  groupsWithStatus,
  hasDraftFields,
} from '@mfd/object-library';
import { catalog } from '@mfd/object-library/catalog';

import { useEditor } from '@/editor/useEditor';

import { DraftDataBadge } from './DraftDataBadge';

/**
 * The manufacturer's own dimensions, or null when the record has none.
 *
 * Height is included when it is known, because an engineer checking a machine through a
 * doorway needs it and the plan cannot show it.
 */
function manufacturerSize(object: EquipmentObject): string | null {
  const { width, depth, height } = object.manufacturerDimensions;
  if (width === null || depth === null) return null;
  return height === null ? `${width} × ${depth} mm` : `${width} × ${depth} × ${height} mm`;
}

/**
 * Short wording for a field group, for a chip two centimetres wide.
 *
 * `FIELD_GROUP_LABELS` in the package is the wording for the report, where the row has
 * room for "Manufacturer dimensions". This is the same set of groups abbreviated for the
 * panel — typed as a total record, so adding a group to the package fails the build here
 * rather than quietly dropping a chip.
 */
const GROUP_CHIP_LABELS: Readonly<Record<VerifiedFieldGroup, string>> = {
  manufacturerDimensions: 'dimensions',
  serviceClearance: 'clearance',
  power: 'power',
  roWater: 'RO water',
  drain: 'drain',
  environmental: 'environment',
};

/** Why a group carries the status it does, for the chip's tooltip. */
function verificationNote(group: VerifiedFieldGroup, verification: FieldVerification): string {
  const { status, source } = verification;
  const label = GROUP_CHIP_LABELS[group];

  if (status === 'verified') {
    const citation = [source.document, source.revision, source.section]
      .filter(Boolean)
      .join(' · ');
    return `${label}: verified — ${citation}`;
  }

  return `${label}: draft — no manual reference recorded yet (current figures are a ${source.type.replace('_', ' ')}). A finding that reads this group is provisional.`;
}

function draftCount(object: EquipmentObject): number {
  return groupsWithStatus(object, 'draft').length;
}

/**
 * The equipment catalogue, as a panel.
 *
 * Everything shown is read from the catalogue JSON — the model name, the footprint,
 * the draft marking. Adding a machine is a data change, not a code change.
 */
export function EquipmentPalette() {
  const { state, dispatch } = useEditor();

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Equipment catalogue">
      <header className="border-b border-edge px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Equipment
        </h2>
        <p className="mt-0.5 text-[11px] text-ink-faint">
          {catalog.objects.length} object{catalog.objects.length === 1 ? '' : 's'} · click
          to arm, then click the canvas
        </p>
      </header>

      <ul className="flex-1 overflow-y-auto p-2">
        {catalog.objects.map((object) => {
          const isArmed = state.armedEquipmentObjectId === object.id;

          return (
            <li key={object.id}>
              <button
                type="button"
                data-testid={`catalog-item-${object.id}`}
                aria-pressed={isArmed}
                onClick={() =>
                  dispatch({
                    type: 'equipment/arm',
                    equipmentObjectId: isArmed ? null : object.id,
                  })
                }
                className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                  isArmed
                    ? 'border-accent bg-accent-soft'
                    : 'border-transparent hover:border-edge hover:bg-chrome-hover'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-ink">{object.model}</span>
                  {hasDraftFields(object) && (
                    <DraftDataBadge
                      title={`${draftCount(object)} of ${VERIFIED_FIELD_GROUPS.length} field groups are still placeholders. The chips below name them.`}
                    />
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-ink-muted">
                  {/* Null for a generic planning object, which is not a product. */}
                  {object.manufacturer ?? 'Generic planning object'}
                </div>
                {/*
                  Both figures, labelled, because they answer different questions: the
                  footprint is what the drawing reserves, the manufacturer dimensions are
                  what arrives on site. Showing one without saying which is how they came
                  to be confused in the first place.
                */}
                <div className="mt-1 font-mono text-[11px] tabular-nums">
                  <span className="text-ink-faint">plan </span>
                  <span
                    className="text-ink-muted"
                    data-testid={`footprint-${object.id}`}
                  >
                    {object.designFootprint.width} × {object.designFootprint.depth} mm
                  </span>
                </div>
                {manufacturerSize(object) && (
                  <div className="font-mono text-[11px] tabular-nums">
                    <span className="text-ink-faint">unit </span>
                    <span
                      className="text-ink-faint"
                      data-testid={`manufacturer-size-${object.id}`}
                    >
                      {manufacturerSize(object)}
                    </span>
                  </div>
                )}

                {/*
                  Verification, per field group.

                  A record is no longer draft or verified as a whole, so a single badge
                  cannot say what is known. An engineer about to place this machine needs
                  to know that its dimensions are sourced and its clearances are not —
                  those two facts lead to different conversations with the customer.

                  Spans rather than a list, because this sits inside a button and a button
                  may only contain phrasing content.
                */}
                <span
                  data-testid={`data-status-${object.id}`}
                  className="mt-1.5 flex flex-wrap gap-1"
                >
                  {VERIFIED_FIELD_GROUPS.map((group) => {
                    const verification = fieldVerification(object, group);
                    const isVerified = verification.status === 'verified';

                    return (
                      <span
                        key={group}
                        data-testid={`data-status-${object.id}-${group}`}
                        data-status={verification.status}
                        title={verificationNote(group, verification)}
                        className={`rounded-sm border px-1 py-px font-mono text-[9px] leading-none ${
                          isVerified
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                            : 'border-amber-500/40 bg-amber-500/10 text-amber-300/90'
                        }`}
                      >
                        {GROUP_CHIP_LABELS[group]}
                      </span>
                    );
                  })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {catalog.draftObjects.length > 0 && (
        <footer className="border-t border-edge px-3 py-2 text-[11px] leading-snug text-ink-muted">
          <span className="font-medium text-amber-300">
            {catalog.draftObjects.length === 1
              ? '1 object has placeholder fields.'
              : `${catalog.draftObjects.length} objects have placeholder fields.`}
          </span>{' '}
          Amber marks a group with no manual reference yet. A finding that reads one is
          provisional; one resting only on green groups is not. Planning footprints are an
          owner decision and carry no citation, so they are not listed here.
        </footer>
      )}
    </section>
  );
}
