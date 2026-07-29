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

/**
 * Bump as sprints land; tools unlock themselves.
 *
 * Numbering follows docs/roadmap/MVP_PLAN.md: 1 Foundation, 2 Equipment Object
 * System, 3 Rule Engine, 4 PDF Workflow, 5 Report Generation, 6 AI Assistant.
 */
export const CURRENT_SPRINT = 4;

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
    id: 'measure',
    label: 'Measure',
    shortcut: 'm',
    hint: 'Measure a distance between two points',
    availableFrom: 5,
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
