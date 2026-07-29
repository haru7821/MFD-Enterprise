import { useKeyboardShortcuts } from '@/editor/useKeyboardShortcuts';
import { DesignCanvas } from '@/features/canvas/DesignCanvas';
import { EquipmentPalette } from '@/features/equipment/EquipmentPalette';
import { Toolbar } from '@/features/toolbar/Toolbar';

import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';

/**
 * Application frame: title bar, toolbar, equipment palette, drawing surface,
 * status bar.
 *
 * The properties inspector and violation list arrive with the rule engine in
 * Sprint 3.
 */
export function AppShell() {
  useKeyboardShortcuts();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-chrome text-ink">
      <TopBar />
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <EquipmentPalette />
        <main className="relative min-h-0 flex-1">
          <DesignCanvas />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
