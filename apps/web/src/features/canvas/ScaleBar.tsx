import { type Viewport, chooseGridSpec, formatLength, worldToScreenLength } from '@mfd/cad-engine';

/**
 * Scale bar.
 *
 * A zoom percentage is meaningless to a facility engineer; a bar labelled "5 m" is
 * not. Rendered as HTML rather than on the canvas so the text stays crisp at any
 * device pixel ratio.
 */
export function ScaleBar({ viewport }: { readonly viewport: Viewport }) {
  const spec = chooseGridSpec(viewport.scale);

  // Pick the first round length that is wide enough on screen to be legible.
  const candidates = [spec.step, spec.majorStep, spec.majorStep * 5, spec.majorStep * 10];
  const length =
    candidates.find((candidate) => worldToScreenLength(viewport, candidate) >= 64) ??
    spec.majorStep;

  const width = worldToScreenLength(viewport, length);

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1">
      <span className="text-[11px] leading-none font-medium text-ink-muted tabular-nums">
        {formatLength(length)}
      </span>
      <div
        className="h-[6px] border-x border-b border-ink-faint"
        style={{ width: `${width}px` }}
      />
    </div>
  );
}
