import { useState } from 'react';

import { activeLevel } from '@/editor/editorState';
import { useEditor } from '@/editor/useEditor';
import { useKeyboardShortcuts } from '@/editor/useKeyboardShortcuts';
import { DesignCanvas } from '@/features/canvas/DesignCanvas';
import { ReportPanel } from '@/features/report/ReportPanel';
import { Toolbar } from '@/features/toolbar/Toolbar';
import { ValidationPanel } from '@/features/validation/ValidationPanel';
import { useEvaluation } from '@/features/validation/useEvaluation';

import { ProjectSidebar } from './ProjectSidebar';
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
  // Mounted only while open, so the report model — which evaluates every level — is not built
  // on every canvas interaction. The live panel keeps evaluating the active level alone.
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-chrome text-ink">
      <TopBar onOpenReport={() => setReportOpen(true)} />
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <ProjectSidebar />
        <main className="relative min-h-0 flex-1">
          <DesignCanvas report={report} />
          {reportOpen && <ReportPanel onClose={() => setReportOpen(false)} />}
        </main>
        <ValidationPanel report={report} placements={activeLevel(state).placements} />
      </div>
      <StatusBar report={report} />
    </div>
  );
}
