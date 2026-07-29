import { AppShell } from '@/app/AppShell';
import { EditorProvider } from '@/editor/EditorProvider';

export function App() {
  return (
    <EditorProvider>
      <AppShell />
    </EditorProvider>
  );
}
