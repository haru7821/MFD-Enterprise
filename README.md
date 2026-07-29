# MFD-Enterprise

**MFD-E TS Edition** — an AI-assisted dialysis facility design application for Vantive
Technical Service engineers.

It is not a replacement for CAD. Its job is to help a TS engineer evaluate dialysis
installation feasibility quickly and accurately, and every engineering value it applies is
data it can cite back to a manual, not a number someone wrote from memory.

**Current release: v0.4 Alpha — Sprints 1–4 delivered.** Import a hospital floor plan,
calibrate its scale, trace the rooms, place equipment, and see every installation
requirement checked live.

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
| `pnpm test` | Run the engine unit tests (362) |
| `pnpm test:e2e` | Run the browser specs against a production build (40) |
| `pnpm bench` | Rule engine performance baseline |
| `pnpm test:perf` | Frame-time measurement — an instrument, not a gate |
| `pnpm typecheck` | Type-check every workspace |
| `pnpm lint` | Lint every workspace |

## What v0.4 Alpha does

A complete feasibility-review workflow, minus the report:

1. **Import the hospital's drawing** — PDF, PNG or JPG. PDF pages are rasterised; the
   image is embedded in the project file, so a project emailed to a colleague arrives with
   its floor plan.
2. **Calibrate it.** Pick two points on a known distance and type the distance. There is
   no skip: until the scale is set the drawing has no millimetres in it, the status bar
   says so, and every finding is capped at YELLOW.
3. **Trace the rooms.** Click to place vertices, close the ring on the first point or with
   Enter. Live segment length and running area while drawing.
4. **Place equipment** from the catalogue, drag it, rotate it, delete it.
5. **Read the findings.** Clearance, equipment collision and room-boundary checks, each
   naming the machine, the threshold applied, where that threshold came from, and whether
   the data behind it is verified or provisional.
6. **Save and reopen** as a `.mfd.json` file, validated in both directions.

Undo and redo cover all of it. One drag is one undo step; one renaming session is one undo
step.

Underneath:

- **Millimetre model space.** Everything is stored in millimetres; pixels exist only while
  drawing to the screen, and are never persisted.
- **No engineering value is written in code.** Search the rule engine for a millimetre
  figure and you will not find one — every number comes from a rule file or an equipment
  record, and every finding says which.
- **Nothing provisional can be signed off.** A pass computed from placeholder data reports
  YELLOW, never GREEN. A *violation* is never softened for the same reason in reverse:
  poor data must not hide problems.

It does **not** yet generate the PDF report (Sprint 5), read vector geometry from a PDF,
or parse DWG or IFC. See [docs/roadmap/MVP_PLAN.md](docs/roadmap/MVP_PLAN.md).

## Repository layout

```
MFD-Enterprise
├── CLAUDE.md               long-term vision and engineering principles
├── docs/
│   ├── product/            TS Edition specification — current scope
│   ├── architecture/       system architecture, tech stack
│   ├── data-model/         project model, equipment object model
│   ├── equipment/          equipment object specifications
│   ├── rules/              rule engine specification
│   ├── roadmap/            sprint plans
│   └── OPEN_QUESTIONS.md   what we still need from the product owner
├── apps/
│   ├── web/                React + Vite client (the designer)          ← built
│   ├── api/                NestJS backend                              not in Version 1
│   └── ai-service/         Python FastAPI AI service                   Sprint 6
├── packages/
│   ├── cad-engine/         geometry, units, viewport, polygons, plan transform  ← built
│   ├── object-library/     equipment catalogue                                  ← built
│   ├── document-model/     the project document, commands, save/load            ← built
│   ├── rule-engine/        installation requirement evaluation                  ← built
│   └── report-engine/      installation review PDF                        Sprint 5
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
| [docs/data-model/PROJECT_MODEL.md](docs/data-model/PROJECT_MODEL.md) | Project · Level · Boundary · Space · Placement |
| [docs/data-model/OBJECT_MODEL.md](docs/data-model/OBJECT_MODEL.md) | Equipment object: catalogue record, provenance, draft vs verified |
| [docs/equipment/VANTIVE_AK98_OBJECT_SPEC.md](docs/equipment/VANTIVE_AK98_OBJECT_SPEC.md) | The first equipment object |
| [docs/rules/DIALYSIS_RULE_ENGINE_v0.1.md](docs/rules/DIALYSIS_RULE_ENGINE_v0.1.md) | Rule categories, result levels, rule data structure |
| [docs/architecture/DOCUMENT_MODEL.md](docs/architecture/DOCUMENT_MODEL.md) | What a project *is*, and why undo is commands rather than snapshots |
| [docs/architecture/RULE_ENGINE_API.md](docs/architecture/RULE_ENGINE_API.md) | The frozen finding contract every consumer reads |
| [docs/roadmap/MVP_PLAN.md](docs/roadmap/MVP_PLAN.md) | Sprint-by-sprint scope and acceptance criteria |
| [docs/roadmap/DEVELOPMENT_ROADMAP.md](docs/roadmap/DEVELOPMENT_ROADMAP.md) | Long view, version map, risk register |
| [docs/architecture/SYSTEM_ARCHITECTURE.md](docs/architecture/SYSTEM_ARCHITECTURE.md) | Architecture and the decisions behind it |
| [docs/architecture/TECH_STACK.md](docs/architecture/TECH_STACK.md) | Versions and the reasoning behind them |
| [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) | **What we still need from the product owner** |
| [CLAUDE.md](CLAUDE.md) | Long-term direction and engineering principles |

`docs/OPEN_QUESTIONS.md` is the important one.

Four sprints in, **the application is finished and empty**. The plan imports, the scale
calibrates, the rooms trace, the rule engine evaluates — and every finding still reads
"threshold unknown", because there is no true figure to compare against. The AK98
installation manual, with its document number and revision, is the one thing standing
between this and a usable answer. Nothing here will invent one.
