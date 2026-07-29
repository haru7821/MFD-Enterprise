import { type ReactNode, useMemo, useReducer } from 'react';

import { EditorContext } from './EditorContext';
import { editorReducer } from './editorReducer';
import { INITIAL_EDITOR_STATE } from './editorState';

export function EditorProvider({ children }: { readonly children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, INITIAL_EDITOR_STATE);

  // dispatch is stable, so the context value only changes when state does.
  const value = useMemo(() => ({ state, dispatch }), [state]);

  return <EditorContext value={value}>{children}</EditorContext>;
}
