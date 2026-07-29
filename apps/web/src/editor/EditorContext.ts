import { createContext, type Dispatch } from 'react';

import type { EditorAction } from './editorReducer';
import type { EditorState } from './editorState';

export interface EditorContextValue {
  readonly state: EditorState;
  readonly dispatch: Dispatch<EditorAction>;
}

/** Null until an EditorProvider is mounted — useEditor turns that into a clear error. */
export const EditorContext = createContext<EditorContextValue | null>(null);
