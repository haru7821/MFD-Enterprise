# MFD-Enterprise

**MFD-E TS Edition** — an AI-assisted dialysis facility design application for Vantive
Technical Service engineers.

It is not a replacement for CAD. Its job is to help a TS engineer evaluate dialysis
installation feasibility quickly and accurately, and every engineering value it applies is
data it can cite back to a manual, not a number someone wrote from memory.

**Current release: v0.1 Alpha — Sprint 1 partially delivered (project structure and canvas
foundation).**

Current scope is defined by
[docs/product/MFD-E_TS_EDITION_SPEC.md](docs/product/MFD-E_TS_EDITION_SPEC.md).
[CLAUDE.md](CLAUDE.md) describes the long-term vision; where the two differ, the TS Edition
specification governs.

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

It does **not** yet import floor plans, place equipment, validate installations, or export
reports. Those are the rest of Sprint 1 and Sprints 2–4 — see
[docs/roadmap/MVP_PLAN.md](docs/roadmap/MVP_PLAN.md).

## Repository layout

```
MFD-Enterprise
├── CLAUDE.md               long-term vision and engineering principles
├── docs/
│   ├── product/            TS Edition specification — current scope
│   ├── equipment/          equipment object specifications
│   ├── rules/              rule engine specification
│   └── roadmap/            sprint plans
├── apps/
│   ├── web/                React + Vite client (the designer)          ← built
│   ├── api/                NestJS backend                              not in Version 1
│   └── ai-service/         Python FastAPI AI service                   Version 3
├── packages/
│   ├── cad-engine/         geometry, units, viewport, grid             ← built
│   ├── object-library/     equipment catalogue                         Sprint 1 · Task 2
│   ├── rule-engine/        installation requirement evaluation         Sprint 1 · Task 5
│   └── report-engine/      installation review PDF                     Sprint 4
├── database/               schema, migrations, seed data
├── standards/              rule sets as versioned data
├── assets/                 symbols, icons, models
└── tests/                  cross-package integration and E2E tests
```

The dependency rule is one-way: `apps/` may import `packages/`, never the reverse, and
`packages/` may not import a UI framework, a renderer or a Node built-in. That boundary
is enforced by ESLint, not by memory — see `eslint.config.js`.

## Documentation

Read in this order:

| Document | Read it for |
| --- | --- |
| [docs/product/MFD-E_TS_EDITION_SPEC.md](docs/product/MFD-E_TS_EDITION_SPEC.md) | **What we are building now** — product definition, user, MVP features |
| [docs/equipment/VANTIVE_AK98_OBJECT_SPEC.md](docs/equipment/VANTIVE_AK98_OBJECT_SPEC.md) | The first equipment object |
| [docs/rules/DIALYSIS_RULE_ENGINE_v0.1.md](docs/rules/DIALYSIS_RULE_ENGINE_v0.1.md) | Rule categories, result levels, rule data structure |
| [docs/roadmap/CLAUDE_SPRINT1_PROMPT.md](docs/roadmap/CLAUDE_SPRINT1_PROMPT.md) | The current sprint instruction |
| [docs/roadmap/MVP_PLAN.md](docs/roadmap/MVP_PLAN.md) | Sprint-by-sprint scope and acceptance criteria |
| [docs/roadmap/DEVELOPMENT_ROADMAP.md](docs/roadmap/DEVELOPMENT_ROADMAP.md) | Versions 1–4 and the risk register |
| [docs/03_SYSTEM_ARCHITECTURE.md](docs/03_SYSTEM_ARCHITECTURE.md) | Architecture and the decisions behind it |
| [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) | **What we still need from the product owner** |
| [CLAUDE.md](CLAUDE.md) | Long-term direction and engineering principles |

`docs/OPEN_QUESTIONS.md` is the important one. Sprint 3 is blocked without the real AK98
clearance figures and the manual revision they come from — until those arrive the rule
engine can be built but not seeded with anything true.
