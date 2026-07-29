export function TopBar() {
  return (
    <header className="flex items-center gap-3 border-b border-edge bg-chrome-raised px-3 py-2">
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center rounded bg-accent text-[11px] font-bold text-canvas"
          aria-hidden="true"
        >
          M
        </span>
        <span className="text-sm font-semibold tracking-tight">MFD-E</span>
      </div>

      <div className="h-4 w-px bg-edge" aria-hidden="true" />

      <span className="text-sm text-ink-muted">Untitled dialysis unit</span>

      <span className="ml-auto font-mono text-[11px] text-ink-faint">
        v0.1 Alpha · Sprint 1 — canvas foundation
      </span>
    </header>
  );
}
