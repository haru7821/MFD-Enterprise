# @mfd/web

The MFD-E designer client — React 19, Vite, Tailwind CSS v4, Konva.

```bash
pnpm dev       # from the repository root, or `pnpm --filter @mfd/web dev`
```

Opens on http://localhost:5173.

## Structure

```
src/
├── main.tsx                     entry point
├── App.tsx                      provider + shell
├── styles.css                   Tailwind import and design tokens
├── app/                         application frame
│   ├── AppShell.tsx             top bar · toolbar · canvas · status bar
│   ├── TopBar.tsx
│   └── StatusBar.tsx            live cursor position, grid step, zoom
├── editor/                      editor state — the app's single store
│   ├── editorState.ts           state shape and initial value
│   ├── editorReducer.ts         every state transition, in one file
│   ├── EditorContext.ts
│   ├── EditorProvider.tsx
│   ├── useEditor.ts
│   ├── useKeyboardShortcuts.ts
│   └── tools.ts                 tool registry, including not-yet-built tools
├── features/
│   ├── canvas/                  the drawing surface
│   │   ├── DesignCanvas.tsx     Konva stage, sized by ResizeObserver
│   │   ├── GridLayer.tsx        paints the grid cad-engine computed
│   │   ├── OriginMarker.tsx     model origin and axes
│   │   ├── ScaleBar.tsx         labelled scale bar
│   │   ├── NavigationHint.tsx   shortcut legend
│   │   ├── useCanvasInteraction.ts   wheel, pointer and Space-to-pan
│   │   └── useElementSize.ts
│   └── toolbar/
│       ├── Toolbar.tsx
│       └── ToolButton.tsx
└── components/icons.tsx         inline SVG icon set
```

## How the canvas works

The Konva `Stage` is **never scaled or translated**. Zoom and pan live in the viewport
held by `editorState`, and every screen position is produced by `@mfd/cad-engine`. Konva
receives finished pixel coordinates and nothing else.

This costs a little convenience today and buys three things later: vector PDF export,
server-side rendering of drawings, and a renderer that can be swapped without touching
the geometry.

The grid is painted as two Konva shapes — one path for minor lines, one for major —
rather than one node per line, so the scene graph stays flat however far you zoom out.

## State

One `useReducer` behind a context. No state library yet: Sprint 2 adds the document model
and an undo/redo command stack, and a reducer is already the right shape for both. A
dependency gets added when it earns its place, not before.

## Interaction model

| Input | Action |
| --- | --- |
| Wheel | Pan vertically |
| Shift + wheel | Pan horizontally |
| Ctrl / Cmd + wheel | Zoom about the cursor |
| Middle-drag, or Space + drag | Pan |
| `V` / `H` | Select / Pan tool |
| `G` / `S` | Toggle grid / snap |
| `+` / `-` / `0` | Zoom in / out / reset view |

Wheel listeners are attached natively rather than through React props: a wheel handler
must be non-passive to call `preventDefault`, and React attaches wheel listeners
passively, which would let the page scroll underneath the canvas.
