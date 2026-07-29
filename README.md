# MFD-Enterprise

**MFD-E** — an AI Medical Facility Design Platform.

MFD-E is not a CAD drawing tool. It designs, validates, documents and manages medical
facilities, and every engineering rule it enforces is data it can cite, not code someone
wrote from memory.

**Current release: v0.1 Alpha — Sprint 1, canvas foundation.**

---

## Quick start

Requires **Node.js ≥ 20.19** and **pnpm ≥ 10** (`npm install -g pnpm`).

```bash
pnpm install     # install dependencies for every workspace
pnpm dev         # start the designer at http://localhost:5173
```

Other commands, all run from the repository root:

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the web client with hot reload |
| `pnpm build` | Type-check and produce a production build in `apps/web/dist` |
| `pnpm preview` | Serve the production build locally |
| `pnpm test` | Run the engine unit tests |
| `pnpm typecheck` | Type-check every workspace |
| `pnpm lint` | Lint every workspace |

## What v0.1 Alpha does

A drawing surface you can navigate at real building scale:

- **Millimetre model space.** Everything is stored in millimetres. Pixels exist only
  while drawing to the screen.
- **Adaptive grid.** Spacing steps through 1–2–5 (…50 mm, 100 mm, 200 mm, 500 mm, 1 m…)
  so lines stay readable at any zoom, and every major line is a whole power of ten.
- **Zoom and pan.** Wheel pans, `Ctrl`/`Cmd` + wheel zooms about the cursor, middle-drag
  or `Space` + drag pans. Zoom range 1 %–3200 %.
- **Toolbar.** Select and Pan are live; Room, Measure and Equipment are shown disabled
  with the sprint that delivers them.
- **Status bar and scale bar.** Live cursor position in millimetres (snapped when snap is
  on), current grid step, zoom, and a labelled scale bar.

It does **not** yet draw rooms, place equipment, validate clearances, save, or export.
Those are Sprints 2–6 — see [docs/roadmap/MVP_PLAN.md](docs/roadmap/MVP_PLAN.md).

## Repository layout

```
MFD-Enterprise
├── CLAUDE.md               project instruction — the governing document
├── docs/                   vision, architecture, engines, database, AI, roadmap
├── apps/
│   ├── web/                React + Vite client (the designer)          ← built
│   ├── api/                NestJS backend                              Sprint 5
│   └── ai-service/         Python FastAPI AI service                   Phase 2
├── packages/
│   ├── cad-engine/         geometry, units, viewport, grid             ← built
│   ├── object-library/     equipment catalogue                         Sprint 3
│   ├── rule-engine/        medical standard evaluation                 Sprint 4
│   └── report-engine/      PDF and drawing output                      Sprint 6
├── database/               schema, migrations, seed data
├── standards/              medical rule sets as versioned data
├── assets/                 symbols, icons, models
└── tests/                  cross-package integration and E2E tests
```

The dependency rule is one-way: `apps/` may import `packages/`, never the reverse, and
`packages/` may not import a UI framework, a renderer or a Node built-in. That boundary
is enforced by ESLint, not by memory — see `eslint.config.js`.

## Documentation

| Document | Read it for |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | The product instruction every decision answers to |
| [docs/03_SYSTEM_ARCHITECTURE.md](docs/03_SYSTEM_ARCHITECTURE.md) | Architecture and the decisions behind it |
| [docs/roadmap/DEVELOPMENT_ROADMAP.md](docs/roadmap/DEVELOPMENT_ROADMAP.md) | Phases 0–4 and the risk register |
| [docs/roadmap/MVP_PLAN.md](docs/roadmap/MVP_PLAN.md) | Sprint-by-sprint MVP scope |
| [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) | **What we still need from the product owner** |

`docs/OPEN_QUESTIONS.md` is the important one. Several items there block Sprints 3–4
outright: without the governing medical standard and real equipment dimensions, a rule
engine has nothing true to enforce.
