# Tech Stack

> What we build with, at what version, and why. Versions are those installed as of
> v0.1 Alpha.

## Chosen in CLAUDE.md

| Layer | Technology | Installed | Notes |
| --- | --- | --- | --- |
| Frontend | React + TypeScript | React 19.2 | |
| Build | Vite | 8.1 | Rolldown-based |
| Styling | Tailwind CSS | 4.3 | CSS-first config via `@theme`, Vite plugin |
| 2D graphics | Konva + react-konva | 10.3 / 19.2 | Renderer only — it never owns geometry |
| Backend | Node.js + NestJS | — | Sprint 5 |
| Database | PostgreSQL | — | Sprint 5 |
| AI | Python + FastAPI | — | Phase 2 |
| 3D | Three.js | — | Phase 4 (Digital Twin) |
| Desktop | Electron | — | Phase 3, and only if offline use is confirmed |

## Added to make the above work

| Concern | Choice | Why |
| --- | --- | --- |
| Monorepo | pnpm workspaces 10 | `packages/` links into `apps/` with no publish step and no build step between them |
| Tests | Vitest 4 | Domain packages are pure TypeScript, so they test headlessly — no browser, no DOM |
| Lint | ESLint 10 + typescript-eslint 8 | Also enforces the `packages/` import boundary |
| Types | TypeScript 6.0 | See the note below |

## TypeScript: 6.0, not 7.0

TypeScript 7 (the native compiler) installs and type-checks this repository correctly,
but `typescript-eslint` does not support it yet — it refuses to load against the TS 7
API. The choice was between keeping the faster compiler and keeping the linter.

We kept the linter. A rule that is enforced by tooling is worth more than a compiler that
finishes a second sooner, and the ESLint config is what stops `packages/cad-engine` from
quietly acquiring a React import. Revisit when typescript-eslint ships TS 7 support
(tracked upstream at typescript-eslint issue #10940).

## Strictness

`tsconfig.base.json` turns on `strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`,
`noUnusedLocals` and `noUnusedParameters`.

All of these are cheap on an empty repository and expensive on a full one. Enabling them
now is the same reasoning as fixing the millimetre coordinate system now.

## Not yet chosen

- **State management** — a reducer plus context is carrying the editor today. Revisit
  when the document model and undo/redo land in Sprint 2.
- **Geometry primitives** — polygon boolean operations and offsetting (for clearance
  envelopes) will come from a proven library, not from us. Decision due in Sprint 3.
- **PDF generation** — must produce vector output, not a canvas screenshot. Decision due
  in Sprint 6.
- **Formatter** — no Prettier yet; ESLint is not enforcing style. Worth adding before the
  team grows past one developer.

## Related

- [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)
- [MFD-E_TS_EDITION_SPEC.md](../product/MFD-E_TS_EDITION_SPEC.md)
- [CLAUDE.md](../../CLAUDE.md)
