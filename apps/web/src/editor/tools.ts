/**
 * Tool registry.
 *
 * Tools that a later sprint delivers are listed here on purpose and rendered
 * disabled, with the sprint that unlocks them. A greyed-out button that says
 * "Sprint 3" is honest; a button that looks live and does nothing is not.
 */

export type ToolId =
  | 'select'
  | 'pan'
  | 'room'
  | 'obstruction'
  | 'equipment'
  | 'reference'
  | 'measure';

export interface ToolDefinition {
  readonly id: ToolId;
  readonly label: string;
  /** Single-key shortcut, lower case. */
  readonly shortcut: string;
  readonly hint: string;
  /**
   * Sprint in which this tool becomes usable, or **null for not scheduled**.
   *
   * Null exists because `measure` needed it: it was listed for Sprint 5, Sprint 5 delivered the
   * report engine instead, and nothing has been built. Leaving it at 5 while the counter moved
   * past 5 would have enabled a button that does nothing — the exact dishonesty this registry's
   * docstring warns about, arriving through a number nobody re-checked.
   */
  readonly availableFrom: number | null;
}

/**
 * Bump as sprints land; tools unlock themselves.
 *
 * Numbering follows docs/roadmap/MVP_PLAN.md: 1 Foundation, 2 Equipment Object
 * System, 3 Rule Engine, 4 PDF Workflow, 5 Report Generation, 6 AI Assistant.
 */
export const CURRENT_SPRINT = 6;

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'select',
    label: 'Select',
    shortcut: 'v',
    hint: 'Select and inspect objects',
    availableFrom: 1,
  },
  {
    id: 'pan',
    label: 'Pan',
    shortcut: 'h',
    hint: 'Drag to move the view — or hold Space with any tool',
    availableFrom: 1,
  },
  {
    id: 'equipment',
    label: 'Equipment',
    shortcut: 'e',
    hint: 'Click the canvas to place the selected equipment',
    availableFrom: 2,
  },
  {
    id: 'room',
    label: 'Room',
    shortcut: 'r',
    hint: 'Click to trace a room — click the first point again, or double-click, to close it',
    availableFrom: 4,
  },
  {
    id: 'obstruction',
    label: 'Obstruction',
    shortcut: 'o',
    hint: 'Trace a column, shaft or fixed obstacle — equipment must not overlap it',
    availableFrom: 4,
  },
  {
    id: 'reference',
    label: 'Reference',
    shortcut: 'f',
    hint: 'Place where a service enters, equipment is delivered, or staff work from',
    availableFrom: 6,
  },
  {
    // Planned for Sprint 5 and not built — Sprint 5 delivered the report engine. Listed and
    // disabled rather than removed, because it is still wanted; `null` says "not scheduled"
    // rather than claiming a sprint that has already passed.
    id: 'measure',
    label: 'Measure',
    shortcut: 'm',
    hint: 'Measure a distance between two points',
    availableFrom: null,
  },
];

export function isToolAvailable(tool: ToolDefinition): boolean {
  return tool.availableFrom !== null && tool.availableFrom <= CURRENT_SPRINT;
}

export function findAvailableToolByShortcut(key: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.shortcut === key && isToolAvailable(tool));
}

export function getTool(id: ToolId): ToolDefinition {
  const tool = TOOLS.find((candidate) => candidate.id === id);
  if (!tool) throw new Error(`Unknown tool: ${id}`);
  return tool;
}
