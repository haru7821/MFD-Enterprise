/**
 * Tool registry.
 *
 * Tools that a later sprint delivers are listed here on purpose and rendered
 * disabled, with the sprint that unlocks them. A greyed-out button that says
 * "Sprint 3" is honest; a button that looks live and does nothing is not.
 */

export type ToolId = 'select' | 'pan' | 'room' | 'equipment' | 'measure';

export interface ToolDefinition {
  readonly id: ToolId;
  readonly label: string;
  /** Single-key shortcut, lower case. */
  readonly shortcut: string;
  readonly hint: string;
  /** Sprint in which this tool becomes usable. */
  readonly availableFrom: number;
}

/** Bump as sprints land; tools unlock themselves. */
export const CURRENT_SPRINT = 1;

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
    id: 'room',
    label: 'Room',
    shortcut: 'r',
    hint: 'Draw a room boundary',
    availableFrom: 2,
  },
  {
    id: 'measure',
    label: 'Measure',
    shortcut: 'm',
    hint: 'Measure a distance between two points',
    availableFrom: 2,
  },
  {
    id: 'equipment',
    label: 'Equipment',
    shortcut: 'e',
    hint: 'Place equipment from the medical catalogue',
    availableFrom: 3,
  },
];

export function isToolAvailable(tool: ToolDefinition): boolean {
  return tool.availableFrom <= CURRENT_SPRINT;
}

export function findAvailableToolByShortcut(key: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.shortcut === key && isToolAvailable(tool));
}

export function getTool(id: ToolId): ToolDefinition {
  const tool = TOOLS.find((candidate) => candidate.id === id);
  if (!tool) throw new Error(`Unknown tool: ${id}`);
  return tool;
}
