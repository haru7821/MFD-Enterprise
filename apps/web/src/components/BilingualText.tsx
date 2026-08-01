import type { Bilingual } from '@mfd/rule-engine';

/**
 * Korean above English, always both, stacked as two block lines — the convention every bilingual
 * surface in this app uses (`ValidationPanel.tsx` and `@mfd/report-engine`'s rendered `LABELS`).
 *
 * Shared rather than duplicated per panel: `LayoutPanel.tsx` and `InstallationPanel.tsx` both had
 * their own copy, and a bug fixed in one silently outlives it in the other.
 *
 * `bullet` folds a leading "· " into the Korean line only, for a caption that follows a bullet
 * marker in the surrounding list. A plain "· " text node placed before two `block` children does
 * not sit beside the first one — `block` always starts a new line, so the bullet ends up alone on
 * a line above both, not marking either of them.
 */
export function BilingualText({
  text,
  bullet = false,
}: {
  readonly text: Bilingual;
  readonly bullet?: boolean;
}) {
  return (
    <>
      <span className="block">{bullet ? `· ${text.ko}` : text.ko}</span>
      <span className="block">{text.en}</span>
    </>
  );
}
