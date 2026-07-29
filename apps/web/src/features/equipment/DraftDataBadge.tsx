/**
 * Marks equipment whose figures are placeholders rather than manual values.
 *
 * Required by the sprint brief: draft data must load, and must be visually obvious.
 * The badge appears in the catalogue palette, on the placed object, and in the
 * status bar — a TS engineer should not be able to reach a conclusion from this
 * drawing without having seen it.
 */
export function DraftDataBadge({ title }: { readonly title?: string }) {
  return (
    <span
      data-testid="draft-badge"
      title={
        title ??
        'Placeholder figures — not taken from the installation manual. Results using this data cannot be treated as verified.'
      }
      className="rounded-sm border border-amber-500/60 bg-amber-500/15 px-1 py-px font-mono text-[9px] leading-none font-bold tracking-wide text-amber-300 uppercase"
    >
      Draft
    </span>
  );
}
