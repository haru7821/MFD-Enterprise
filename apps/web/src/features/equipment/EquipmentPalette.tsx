import { catalog } from '@mfd/object-library/catalog';

import { useEditor } from '@/editor/useEditor';

import { DraftDataBadge } from './DraftDataBadge';

/**
 * The equipment catalogue, as a panel.
 *
 * Everything shown is read from the catalogue JSON — the model name, the footprint,
 * the draft marking. Adding a machine is a data change, not a code change.
 */
export function EquipmentPalette() {
  const { state, dispatch } = useEditor();

  return (
    <aside
      className="flex w-60 shrink-0 flex-col border-r border-edge bg-chrome"
      aria-label="Equipment catalogue"
    >
      <header className="border-b border-edge px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-ink uppercase">Equipment</h2>
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
                  {object.manufacturer}
                </div>
                <div className="mt-1 font-mono text-[11px] text-ink-faint tabular-nums">
                  {object.dimensions.width} × {object.dimensions.depth} mm
                </div>
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
          Real dimensions and clearances are pending the installation manual.
        </footer>
      )}
    </aside>
  );
}
