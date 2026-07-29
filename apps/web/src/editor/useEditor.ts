import { useContext } from 'react';

import { EditorContext, type EditorContextValue } from './EditorContext';

export function useEditor(): EditorContextValue {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error('useEditor must be used inside an <EditorProvider>.');
  }
  return context;
}
