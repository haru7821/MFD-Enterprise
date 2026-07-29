import type { ReactNode } from 'react';

import { ZOOM_STEP, vec2, zoomPercent } from '@mfd/cad-engine';

import {
  EquipmentIcon,
  GridIcon,
  MeasureIcon,
  PanIcon,
  ResetViewIcon,
  RoomIcon,
  SelectIcon,
  SnapIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@/components/icons';
import { TOOLS, type ToolId, isToolAvailable } from '@/editor/tools';
import { useEditor } from '@/editor/useEditor';

import { ToolButton } from './ToolButton';

const TOOL_ICONS: Record<ToolId, ReactNode> = {
  select: <SelectIcon />,
  pan: <PanIcon />,
  room: <RoomIcon />,
  measure: <MeasureIcon />,
  equipment: <EquipmentIcon />,
};

function Divider() {
  return <div className="mx-1.5 h-5 w-px bg-edge" aria-hidden="true" />;
}

function formatZoom(percent: number): string {
  return percent < 10 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`;
}

export function Toolbar() {
  const { state, dispatch } = useEditor();

  const centre = vec2(state.screen.width / 2, state.screen.height / 2);
  const availableTools = TOOLS.filter(isToolAvailable);
  const upcomingTools = TOOLS.filter((tool) => !isToolAvailable(tool));

  return (
    <div
      className="flex items-center border-b border-edge bg-chrome px-2 py-1.5"
      role="toolbar"
      aria-label="Design tools"
    >
      {availableTools.map((tool) => (
        <ToolButton
          key={tool.id}
          icon={TOOL_ICONS[tool.id]}
          label={tool.label}
          shortcut={tool.shortcut}
          description={tool.hint}
          isActive={state.activeTool === tool.id}
          onClick={() => dispatch({ type: 'tool/select', tool: tool.id })}
        />
      ))}

      <Divider />

      {upcomingTools.map((tool) => (
        <ToolButton
          key={tool.id}
          icon={TOOL_ICONS[tool.id]}
          label={tool.label}
          description={`Sprint ${tool.availableFrom}`}
          isDisabled
        />
      ))}

      <div className="ml-auto flex items-center">
        <ToolButton
          icon={<GridIcon />}
          label="Grid"
          shortcut="g"
          description={state.showGrid ? 'Visible' : 'Hidden'}
          isActive={state.showGrid}
          onClick={() => dispatch({ type: 'grid/toggle' })}
        />
        <ToolButton
          icon={<SnapIcon />}
          label="Snap to grid"
          shortcut="s"
          description={state.snapToGrid ? 'On' : 'Off'}
          isActive={state.snapToGrid}
          onClick={() => dispatch({ type: 'snap/toggle' })}
        />

        <Divider />

        <ToolButton
          icon={<ZoomOutIcon />}
          label="Zoom out"
          shortcut="-"
          onClick={() =>
            dispatch({ type: 'viewport/zoomBy', anchor: centre, factor: 1 / ZOOM_STEP })
          }
        />
        <span className="w-14 text-center font-mono text-xs text-ink-muted tabular-nums">
          {formatZoom(zoomPercent(state.viewport))}
        </span>
        <ToolButton
          icon={<ZoomInIcon />}
          label="Zoom in"
          shortcut="="
          onClick={() => dispatch({ type: 'viewport/zoomBy', anchor: centre, factor: ZOOM_STEP })}
        />
        <ToolButton
          icon={<ResetViewIcon />}
          label="Reset view"
          shortcut="0"
          description="Centre the origin at the default zoom"
          onClick={() => dispatch({ type: 'viewport/reset' })}
        />
      </div>
    </div>
  );
}
