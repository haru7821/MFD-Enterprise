import type { EquipmentObject } from '@mfd/object-library';
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
                  {object.dataStatus === 'draft' && <DraftDataBadge />}
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
              </button>
            </li>
          );
        })}
      </ul>

      {catalog.draftObjects.length > 0 && (
        <footer className="border-t border-edge px-3 py-2 text-[11px] leading-snug text-ink-muted">
          <span className="font-medium text-amber-300">
            {catalog.draftObjects.length === 1
              ? '1 object uses placeholder figures.'
              : `${catalog.draftObjects.length} objects use placeholder figures.`}
          </span>{' '}
          Service clearances, and the reason behind each planning footprint, are pending the
          installation manual.
        </footer>
      )}
    </section>
  );
}
