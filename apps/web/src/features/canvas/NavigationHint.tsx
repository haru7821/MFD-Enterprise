const SHORTCUTS: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: 'Wheel', action: 'Pan' },
  { keys: 'Ctrl + Wheel', action: 'Zoom' },
  { keys: 'Space + Drag', action: 'Pan' },
  { keys: 'G', action: 'Grid' },
  { keys: '0', action: 'Reset view' },
];

/**
 * Navigation legend.
 *
 * The canvas is empty until Sprint 2 adds drawing tools, so without this the first
 * run looks broken rather than ready. It also documents the interaction model in
 * the one place the user is actually looking.
 */
export function NavigationHint() {
  return (
    <div className="pointer-events-none absolute right-3 bottom-3 rounded-md border border-edge/70 bg-chrome/80 px-3 py-2 backdrop-blur-sm">
      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-[11px] leading-none">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.keys} className="contents">
            <dt className="font-mono text-ink-faint">{shortcut.keys}</dt>
            <dd className="text-ink-muted">{shortcut.action}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
