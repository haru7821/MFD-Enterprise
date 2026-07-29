import { useEditor } from '@/editor/useEditor';
import { useKeyboardShortcuts } from '@/editor/useKeyboardShortcuts';
import { DesignCanvas } from '@/features/canvas/DesignCanvas';
import { EquipmentPalette } from '@/features/equipment/EquipmentPalette';
import { Toolbar } from '@/features/toolbar/Toolbar';
import { ValidationPanel } from '@/features/validation/ValidationPanel';
import { useEvaluation } from '@/features/validation/useEvaluation';

import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';

/**
 * Application frame: title bar, toolbar, equipment palette, drawing surface,
 * findings panel, status bar.
 *
 * The evaluation is computed once here and passed down, so the canvas overlay and
 * the findings list are always showing the same report rather than two independent
 * runs that could disagree mid-render.
 */
export function AppShell() {
  useKeyboardShortcuts();
  const { state } = useEditor();
  const report = useEvaluation();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-chrome text-ink">
      <TopBar />
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <EquipmentPalette />
        <main className="relative min-h-0 flex-1">
          <DesignCanvas report={report} />
        </main>
        <ValidationPanel report={report} placements={state.placements} />
      </div>
      <StatusBar report={report} />
    </div>
  );
}
