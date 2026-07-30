import { now } from '@/editor/clock';
import { activeLevel } from '@/editor/editorState';
import { useEditor } from '@/editor/useEditor';
import {
  REFERENCE_POINT_LABELS,
  REFERENCE_POINT_ORDER,
} from '@/features/canvas/referencePointLabels';

/**
 * Where the services enter, equipment is delivered, and staff work from.
 *
 * ## Why this panel exists at all, rather than these being inferred
 *
 * Four of the engineering scoring criteria the owner approved — installation feasibility, RO
 * piping, electrical routing and walking distance — are distances **from** one of these points,
 * which is 40 % of the model. None of them can be measured from a drawing: a raster scan does not
 * say which rectangle is an electrical panel, and inferring one would produce a routed distance
 * from a place nobody chose.
 *
 * So an engineer places them, and a level with none placed reports those criteria as inconclusive
 * rather than scoring them as zero — which for a criterion that *minimises* would be the best
 * possible score for a measurement never taken.
 *
 * ## Arming rather than defaulting
 *
 * Choosing a kind arms the tool; there is no default. A tool that placed a drain because drain
 * happened to be first would put a point of the wrong kind on the drawing, and the kind is the
 * field the criteria select on.
 */
export function ReferencePointPanel() {
  const { state, dispatch } = useEditor();
  const level = activeLevel(state);
  const points = level.referencePoints;
  const armed = state.armedReferencePointKind;

  return (
    <section className="border-b border-edge px-3 py-2.5" aria-label="Reference points">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        Reference points
      </h2>

      <div className="mb-2 flex flex-wrap gap-1" data-testid="reference-point-kinds">
        {REFERENCE_POINT_ORDER.map((kind) => (
          <button
            key={kind}
            type="button"
            data-testid={`reference-kind-${kind}`}
            aria-pressed={armed === kind}
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              armed === kind
                ? 'bg-accent/20 text-ink ring-1 ring-accent/60'
                : 'text-ink-muted hover:bg-white/5'
            }`}
            onClick={() =>
              dispatch({ type: 'referencePoint/arm', kind: armed === kind ? null : kind })
            }
          >
            {REFERENCE_POINT_LABELS[kind]}
          </button>
        ))}
      </div>

      {points.length === 0 ? (
        <p className="text-[10px] text-ink-faint" data-testid="reference-point-empty">
          None placed. Piping, wiring and circulation distances cannot be measured on this level
          until they are — those criteria are reported as inconclusive, never as zero.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5" data-testid="reference-point-list">
          {points.map((point) => (
            <li key={point.id} className="flex items-center gap-1">
              <button
                type="button"
                data-testid={`reference-point-${point.id}`}
                className={`flex min-w-0 flex-1 items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-[11px] ${
                  point.id === state.selectedReferencePointId
                    ? 'bg-accent/15 text-ink ring-1 ring-accent/50'
                    : 'text-ink-muted hover:bg-white/5'
                }`}
                onClick={() =>
                  dispatch({ type: 'referencePoint/select', pointId: point.id })
                }
              >
                <span className="truncate">
                  {point.label ?? REFERENCE_POINT_LABELS[point.kind]}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-ink-faint tabular-nums">
                  {Math.round(point.position.x)}, {Math.round(point.position.y)}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Delete ${REFERENCE_POINT_LABELS[point.kind]}`}
                data-testid={`reference-point-delete-${point.id}`}
                className="shrink-0 rounded px-1 py-1 text-[10px] text-ink-faint hover:bg-white/5 hover:text-ink"
                onClick={() =>
                  dispatch({ type: 'referencePoint/delete', pointId: point.id, at: now() })
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedPoint(state.selectedReferencePointId, points) && (
        <label className="mt-2 block">
          <span className="mb-0.5 block text-[10px] text-ink-faint">Label</span>
          <input
            type="text"
            data-testid="reference-point-label"
            className="w-full rounded border border-edge bg-black/20 px-1.5 py-1 text-[11px] text-ink"
            placeholder="e.g. DB-3F-2"
            value={selectedPoint(state.selectedReferencePointId, points)?.label ?? ''}
            onChange={(event) =>
              dispatch({
                type: 'referencePoint/relabel',
                pointId: state.selectedReferencePointId ?? '',
                // Empty means unnamed, and unnamed is null. Storing "" would make a point the
                // engineer deliberately cleared indistinguishable from one never named.
                label: event.target.value === '' ? null : event.target.value,
                at: now(),
              })
            }
          />
        </label>
      )}
    </section>
  );
}

function selectedPoint(
  id: string | null,
  points: ReturnType<typeof activeLevel>['referencePoints'],
) {
  return id === null ? undefined : points.find((point) => point.id === id);
}
