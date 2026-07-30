import type { SVGProps } from 'react';

/**
 * Inline icon set.
 *
 * Icons are drawn here rather than pulled from a package: the set is small, and an
 * icon dependency is a licence, a bundle cost and an upgrade path we do not need
 * for ten glyphs.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SelectIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 2.2 3.5 12.3 6.1 9.9 7.9 13.6 9.7 12.7 8 9.2 11.6 8.9Z" fill="currentColor" />
    </Icon>
  );
}

export function PanIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2v12M2 8h12" />
      <path d="M8 2 6.2 4M8 2l1.8 2M8 14l-1.8-2M8 14l1.8-2M2 8l2-1.8M2 8l2 1.8M14 8l-2-1.8M14 8l-2 1.8" />
    </Icon>
  );
}

export function RoomIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 3.5h11v9h-11z" />
      <path d="M6 12.5v-3" />
    </Icon>
  );
}

export function MeasureIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 6.5h12v3H2z" />
      <path d="M5 6.5v1.6M8 6.5v2.2M11 6.5v1.6" />
    </Icon>
  );
}

export function EquipmentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 2.5h8v11H4z" />
      <path d="M6 5h4" />
      <circle cx="8" cy="9.5" r="1.4" />
    </Icon>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 2.5h11v11h-11z" />
      <path d="M6.2 2.5v11M9.8 2.5v11M2.5 6.2h11M2.5 9.8h11" />
    </Icon>
  );
}

export function SnapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 3v5a4 4 0 0 0 8 0V3" />
      <path d="M4 6.5h3M9 6.5h3" />
    </Icon>
  );
}

export function ZoomInIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.4 10.4 14 14M7 5.2v3.6M5.2 7h3.6" />
    </Icon>
  );
}

export function ZoomOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.4 10.4 14 14M5.2 7h3.6" />
    </Icon>
  );
}

export function ResetViewIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="4.2" />
      <path d="M8 1.4v2.2M8 12.4v2.2M1.4 8h2.2M12.4 8h2.2" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7.5h6.5a3.5 3.5 0 0 1 0 7H7" />
      <path d="M5.5 4.5 3 7.5l2.5 3" />
    </Icon>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 7.5H6.5a3.5 3.5 0 0 0 0 7H9" />
      <path d="M10.5 4.5 13 7.5l-2.5 3" />
    </Icon>
  );
}

export function PlanIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 3.5h11v9h-11z" />
      <path d="M6 3.5v9M2.5 8H6M9.5 8h4" />
    </Icon>
  );
}

/** A crosshair — the same mark the report draws, so the toolbar and the page agree. */
export function ReferencePointIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2v3.5M8 10.5V14M2 8h3.5M10.5 8H14" />
      <circle cx="8" cy="8" r="2.5" />
    </Icon>
  );
}

export function ObstructionIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 3.5h9v9h-9z" />
      <path d="M3.5 6.5 6.5 3.5M3.5 9.5 9.5 3.5M3.5 12.5 12.5 3.5M6.5 12.5 12.5 6.5M9.5 12.5 12.5 9.5" />
    </Icon>
  );
}
