# System Architecture

> Architecture for MFD-E, derived from CLAUDE.md. Status: proposal, partially implemented as of v0.1 Alpha.

## 0. Plain-language summary

MFD-E has three kinds of code, and keeping them separate is the whole design:

1. **The brain** (`packages/`) — pure calculation. Where a machine sits, how far apart
   things must be, whether a layout breaks a rule. It knows nothing about buttons or
   screens. This is the part that must never be rewritten.
2. **The face** (`apps/web`) — what the user sees and clicks. It asks the brain questions
   and draws the answers.
3. **The memory** (`apps/api` + PostgreSQL) — saving projects and re-checking them
   officially before a document is issued.

Plus a fourth thing that is *not* code: **`standards/`**, the folder holding the medical
rules as data files. When a regulation changes, we edit a data file — not the program.
That is the single most important idea in this repository.

---

## 1. Governing Constraints

From CLAUDE.md, four principles drive every decision below:

- Engineering rules are never hard-coded; they are data.
- Medical standards come from database or configuration files.
- Every module is independent.
- Code is production ready — no temporary solutions.

The first two make the **rule representation** the center of the system, not the canvas.
The third makes the **package boundary** the primary design artifact.

## 2. Layering

```
                    ┌──────────────────────────────────────┐
apps/               │ web (React + Vite)   desktop (later) │  presentation
                    │ api (NestJS)   ai-service (FastAPI)  │  transport
                    └──────────────────────────────────────┘
                                     │ depends on (one way only)
                    ┌──────────────────────────────────────┐
packages/           │ cad-engine  object-library           │  domain
                    │ rule-engine report-engine            │  (pure TypeScript)
                    └──────────────────────────────────────┘
                                     │ reads
                    ┌──────────────────────────────────────┐
standards/          │ versioned rule sets (JSON) + sources │  knowledge
                    └──────────────────────────────────────┘
```

**Rule: `packages/` must not import React, NestJS, Konva, Three.js, or any Node-only API.**
A domain package that cannot run unchanged in a browser tab, a Node process, and a test
runner has violated the independence principle.

## 3. Key Architectural Decisions

### AD-1. One coordinate system: millimetres

All geometry is stored in millimetres in a single model space. Pixels exist only inside
the renderer's view transform and are never persisted.

*Rationale:* clearance rules are expressed in millimetres. If the canvas stores pixels,
every rule check has to guess a scale factor. Retrofitting a unit system after the canvas
ships is a full rewrite. Implemented in `packages/cad-engine/src/units.ts`.

### AD-2. Rendering consumes geometry; it does not own it

Konva is one of at least three render targets (screen, PDF, later DXF). The document
model, view transform, hit-testing, and snapping live in `cad-engine`; Konva nodes are
built from that model, never treated as the source of truth.

*Rationale:* PDF export must be vector, not a screenshot. If geometry lives inside Konva
nodes, vector export and server-side rendering are both impossible.
Implemented in v0.1 Alpha: `viewport.ts` and `grid.ts` are pure maths with no Konva import;
`GridLayer.tsx` only draws what they return.

### AD-3. The rule engine is isomorphic and runs in two places

Same `rule-engine` package, same rule data, two call sites:

| Call site | Purpose | Latency budget | Authority |
| --- | --- | --- | --- |
| Browser (during drag) | live violation feedback | < 16 ms incremental | advisory |
| API server (save / report) | authoritative validation | < 2 s full document | **authoritative** |

Every saved project and every generated report stamps the `rule_set_id` and
`rule_set_version` used. A report without a rule version is not defensible.

### AD-4. `standards/` is the source of record; PostgreSQL is a cache plus overrides

CLAUDE.md names both "database" and "configuration files". Reconciled as:

- `standards/rules/**.json` — git-tracked, reviewable, diffable, carries citations.
  This is what an engineer reviews and what an audit points at.
- PostgreSQL — loaded from those files at seed time for querying, plus per-project
  overrides (a hospital's stricter internal standard) as a separate, labelled layer.

Effective rule = base rule set ← jurisdiction overlay ← project override, with the
resolution chain recorded in every validation result.

*Rationale:* regulation text needs history, review, and blame. Git provides that; a table
row does not.

### AD-5. Rules are typed predicates — not embedded code, not a custom scripting language

A rule is a record, not a script. Fixed set of predicate kinds, extended by adding kinds:

- `clearance` — minimum free distance around an object's face or envelope
- `min_distance` / `max_distance` — between two selectors
- `min_area` / `dimension_range` — on a space
- `min_count` / `ratio` — e.g. isolation stations per total stations
- `adjacency_required` / `adjacency_forbidden`
- `egress_reachability` — path width and travel distance to an exit

Every rule record carries: `id`, `version`, `predicate`, `scope`, `parameters`,
`severity` (`error` | `warning` | `advisory`), `jurisdiction`, `source_document`,
`clause`, `effective_date`, `citation_text`.

*Rationale:* `severity` and `citation` are what separate an engineering platform from a
drawing tool. A violation the user cannot trace to a clause is not actionable.

### AD-6. Jurisdiction and code edition are first-class schema fields

A project selects `{jurisdiction, code_edition, facility_type}`; rule sets resolve against
that triple. Korean 의료법 시행규칙, FGI Guidelines, and a hospital's internal standard are
different sets that must coexist.

*Rationale:* this is the one dimension that cannot be retrofitted. Adding it later means
rewriting every rule record and every stored validation result.

### AD-7. Domain model

```
Project ─ Level ─ Space (boundary polygon, function tag, name)
                    └─ Placement (object_id, transform, parameters)
                          └─ Port (service connection point)
        └─ Connection (routing path between ports)   [Phase 2]
```

`Space.function` (hemodialysis bay, water treatment, clean utility, soiled utility,
isolation room, staff station…) is the selector most rules scope on, so the space taxonomy
is a controlled vocabulary, not free text.

### AD-8. Document schema is versioned with migrations from v1

Saved projects carry `schema_version`, with a loader migration chain from the first
release. Undo/redo is a command stack over the document model, not state snapshots.

### AD-9. Geometry primitives are a dependency, not a rewrite

Polygon boolean ops, offsetting (clearance envelopes), point-in-polygon, and
polygon-to-polygon distance come from a proven library behind a thin internal interface.
Only the CAD-specific layer (snapping, constraints, spatial index) is ours.

### AD-10. AI is a constraint solver with a language interface, not a text-to-layout model

`layout-engine` produces candidate layouts under rule-engine constraints. The LLM
interprets intent, explains results, and drafts documentation. A generative layout with no
validator is unusable in a regulated context — which is why AI comes after the rule
engine, not before.

## 4. Deferred / Flagged Decisions

| Item | Position | Why |
| --- | --- | --- |
| Electron | Phase 3 | Packaging, signing, auto-update, second build target cost real time. Web-first with a thin file-I/O abstraction keeps the door open at near-zero cost. Pull forward only if offline hospital use is a hard requirement. |
| Three.js | Phase 4 (Digital Twin) | Nothing before then is 3D. |
| Python AI service | Phase 2 | No v0.1 or v0.2 requirement needs it. |
| Multi-tenancy / RBAC | Decide before `apps/api` | SaaS vs on-prem changes the auth model, not just a config flag. |
| LLM data residency | Decide before Phase 2 | If hospital data cannot leave the network, AD-10's deployment changes fundamentally. |

## 5. Toolchain

| Concern | Choice | Note |
| --- | --- | --- |
| Monorepo | pnpm workspaces | Workspace protocol links `packages/` into `apps/` with no publish step. |
| Build (web) | Vite 7 | Per CLAUDE.md. |
| UI | React 19 + TypeScript strict | |
| Styling | Tailwind CSS v4 | Vite plugin, CSS-first config. |
| 2D canvas | Konva + react-konva | Renderer only — see AD-2. |
| Tests | Vitest | Domain packages tested headlessly; no browser needed. |
| Lint | ESLint flat config + typescript-eslint | |

TypeScript runs with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
and `noImplicitOverride` — settings that are painful to enable later and cheap now.

## 6. Related

- [CLAUDE.md](../CLAUDE.md) — governing instruction
- [DEVELOPMENT_ROADMAP.md](roadmap/DEVELOPMENT_ROADMAP.md)
- [MVP_PLAN.md](roadmap/MVP_PLAN.md)
- [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) — blocking unknowns
