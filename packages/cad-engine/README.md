# @mfd/cad-engine

The geometry core of MFD-E: units, vectors, rectangles, the viewport transform and the
adaptive grid.

## The rule this package exists to enforce

**Pure TypeScript. No React, no Konva, no NestJS, no Node built-ins, no DOM.**

Everything here must run unchanged in a browser tab, a server process and a test runner.
That is not tidiness — it is what makes the rest of the product possible:

- The **rule engine** will need to run in the browser for live feedback while dragging
  *and* on the server as the authority for a signed report. One implementation, two
  call sites, identical results.
- **PDF and DXF export** need geometry that is not trapped inside a renderer's scene
  graph.

The constraint is enforced twice: `tsconfig.json` omits the `DOM` library, so
`document.` will not compile, and `eslint.config.js` blocks framework imports by path.

## Modules

| File | Contains |
| --- | --- |
| `units.ts` | `Millimetres`, metre conversion, `formatLength` |
| `vec2.ts` | Immutable 2D vector, tolerant equality, `snapToStep` |
| `rect.ts` | Axis-aligned rectangle helpers |
| `viewport.ts` | The one place millimetres become pixels — `worldToScreen`, `screenToWorld`, `panBy`, `zoomTo`, `fitRect` |
| `grid.ts` | Adaptive 1–2–5 grid step selection and visible line computation |

## The coordinate model

```
screen_px = model_mm × viewport.scale + viewport.offset
```

`viewport.scale` is screen pixels per millimetre. Zoom is shown to the user as a
percentage where **100 % means one pixel per millimetre**, clamped to 1 %–3200 %.

Model coordinates are never stored in pixels. If a future change makes a pixel value
persistable, that change is wrong.

## Tests

Run from the repository root:

```bash
pnpm test
```

The tests are behavioural, not incidental — for example, "zooming keeps the model point
under the cursor pinned to the cursor" is asserted directly, because that property is
what makes wheel-zoom feel correct and is easy to break silently.
