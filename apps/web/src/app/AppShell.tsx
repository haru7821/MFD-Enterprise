import { useKeyboardShortcuts } from '@/editor/useKeyboardShortcuts';
import { DesignCanvas } from '@/features/canvas/DesignCanvas';
import { Toolbar } from '@/features/toolbar/Toolbar';

import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';

/**
 * Application frame: title bar, toolbar, drawing surface, status bar.
 *
 * The side panels arrive with the features that need them — the equipment library
 * in Sprint 3, the properties inspector and violation list in Sprint 4.
 */
export function AppShell() {
  useKeyboardShortcuts();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-chrome text-ink">
      <TopBar />
      <Toolbar />
      <main className="relative min-h-0 flex-1">
        <DesignCanvas />
      </main>
      <StatusBar />
    </div>
  );
}
