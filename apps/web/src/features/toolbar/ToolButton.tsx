import type { ReactNode } from 'react';

interface ToolButtonProps {
  readonly icon: ReactNode;
  readonly label: string;
  /** Shown in the tooltip after the label, e.g. "V". */
  readonly shortcut?: string;
  readonly description?: string;
  readonly isActive?: boolean;
  readonly isDisabled?: boolean;
  readonly onClick?: () => void;
}

export function ToolButton({
  icon,
  label,
  shortcut,
  description,
  isActive = false,
  isDisabled = false,
  onClick,
}: ToolButtonProps) {
  const tooltip = [label, shortcut ? `(${shortcut.toUpperCase()})` : null, description]
    .filter(Boolean)
    .join(' · ');

  const tone = isDisabled
    ? 'text-ink-faint/60 cursor-not-allowed'
    : isActive
      ? 'bg-accent-soft text-accent'
      : 'text-ink-muted hover:bg-chrome-hover hover:text-ink';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={isActive}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${tone}`}
    >
      {icon}
    </button>
  );
}
