# System Architecture

> Architecture for MFD-E. Status: proposal, partially implemented as of v0.1 Alpha.
>
> **Scope authority:** [MFD-E_TS_EDITION_SPEC.md](../product/MFD-E_TS_EDITION_SPEC.md) defines
> what is built now. CLAUDE.md supplies the engineering principles and the long-term
> direction. Where they differ, the TS Edition specification governs.

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
`result_level` (`GREEN` | `YELLOW` | `RED`, per the rule engine specification),
`source_document`, `revision`, `section`, `effective_date`, `data_status`.

*Rationale:* the result level and the citation are what separate an engineering platform
from a drawing tool. Specification section 6 requires that every rule carry source
information; a result the TS engineer cannot trace back to a manual section cannot be
defended to a customer.

### AD-6. The source of authority is a schema field, and Version 1's authority is the manufacturer manual

Every rule resolves against `{authority, document, revision, equipment_model}`.

For the TS Edition MVP the authority is the **manufacturer installation manual** — not a
national building code. A clearance figure is true *for the AK98, at manual revision X*,
and becomes false when the manual is revised.

The field is nonetheless kept general. Local electrical, drainage and fire requirements
enter in later versions, and a hospital's own internal standard is a third layer. Rule
resolution is therefore: base manual rules ← local requirement overlay ← project override,
with the resolution chain recorded in every result.

*Rationale:* this is the one dimension that cannot be retrofitted. Adding it later means
rewriting every rule record and every stored validation result. It costs one field now.

### AD-6a. Unverified data can never produce a GREEN result

Equipment and rule records carry `data_status: draft | verified`. A record is `verified`
only when it names its source document, revision and section; the loader rejects anything
that claims otherwise.

Any result computed from `draft` data is capped at YELLOW — "Review Required" — and the
draft provenance is carried into the report.

*Rationale:* the project currently holds example figures (900 × 750 mm, 1200 mm clearance)
that are placeholders, not measurements. The failure this product exists to prevent is a
plausible number quietly becoming an authoritative one. That has to be blocked by the
engine, not by whoever remembers.

### AD-7. Domain model

Follows the TS Edition workflow: import drawing → define space → place equipment →
validate → report. Defined in full in
[PROJECT_MODEL.md](../data-model/PROJECT_MODEL.md) and
[OBJECT_MODEL.md](../data-model/OBJECT_MODEL.md).

```
Project
 └ Level                             floor: imported plan image + coordinate mapping
     └ Space                         boundary polygon, function tag, name
         └ Placement                 transform, parameters; Ports are its properties
             └ Equipment Object Reference
```

`Level.coordinateMapping` is produced in Sprint 4 and holds the full image-pixel to
millimetre transform — scale, origin and rotation. Until it is set, no measurement taken
against that plan means anything, so it belongs to the document rather than to the view.

`Port` is a property of `Placement`, derived from the equipment object and positioned by
the placement transform, not a level of the hierarchy. `Connection` (routing between
ports) arrives with the routing work and is not yet scheduled.

`Space.function` (hemodialysis treatment area, water treatment room, clean utility, soiled
utility, isolation…) is the selector most rules scope on, so the space taxonomy is a
controlled vocabulary, not free text.

**Type and instance are separate.** An *Equipment Object* is the catalogue definition
(the AK98 as a model — its dimensions, clearances and provenance). A *Placement* is one
machine on one drawing, referencing that object. Twenty AK98 units share one set of
dimensions, so a manual revision updates all twenty at once. Copying the dimensions into
each placement would let the data drift apart, and drifted equipment data is
indistinguishable from correct equipment data until someone measures a room.

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

### AD-21. `transform.position` is where an object's local `(0, 0)` sits — never assumed to be the centre

`Placement.transform.position` has exactly one meaning: the model-space point that a `Placement`'s
local `(0, 0)` maps to under `localToModel`. Where local `(0, 0)` falls *on the footprint* is a
separate, per-object fact — `EquipmentObject.symbol.origin`, `"front-left"` or `"centre"` — already
documented in `docs/data-model/OBJECT_MODEL.md`. Every shipped catalogue record and fixture is
`"front-left"`: the footprint spans `[0, width] × [0, depth]` in local space, so `position` names
the corner, not the middle.

`@mfd/object-library`'s `geometry.ts` is the sole owner of this contract: `localFootprintRect`,
`footprintCorners`, `footprintBounds`, `footprintCentre`, `clearanceZones`, `faceGeometry`,
`localToModel` and `modelToLocal` are the only functions permitted to read `symbol.origin` and reason
about where a footprint actually sits. Every consumer — the renderer, the three rule-engine
evaluators (collision, clearance, boundary), the report engine's floor plan, the AI solver's scoring
criteria — calls into these rather than re-deriving a footprint from `position` by hand.
`@mfd/rule-engine`'s own clearance evaluator delegates to `faceGeometry` too, rather than keeping its
own copy of the same computation (`evaluators/clearance.ts`'s former private `faceOf`, hoisted here
once two packages needed the identical geometry). The two legitimate directions of travel the other
way — "I have a footprint's desired centre, not a placement", true of a packing algorithm's internal
math, and "I need this placement's centre, not its `transform.position`", true of a routed distance
or a report figure — go through the two named adapters, `transformForCentre` and `footprintCentre`,
and nowhere else.

**What this closed.** Two independent hand-rolled re-derivations both assumed `position` was the
centre: `packages/ai-local/src/generate.ts`'s candidate generator (mistaking every existing
machine's occupied polygon, and placing every new one, half a footprint away from where it was
drawn — `transformForCentre` did not exist before this fix; there was no prior attempt to fix this
one) and `apps/web/src/features/layout/runSolver.ts`'s room-membership test (silently testing the
corner against the room polygon while its own comment claimed "centre-based"). Neither was caught by
a unit fixture, because both bugs are invisible at `rotation: 0` on a `centre`-origin object — no
shipped object is `centre`-origin. Fixed by deleting the hand-rolled geometry and delegating;
regression-tested in `packages/ai-local/src/coordinateContract.test.ts` (drives one rotated
placement through generation and Gate 2, and a serialize/reload round trip) and
`apps/web/src/features/layout/runSolver.test.ts` (the specific corner-vs-centre case: a bed whose
corner sits inside an 8 m room and whose true centre sits 400 mm past its wall).

**What a later review round found still open, in the same fix — since closed.** `criteria.ts`'s
`freeDistanceOnSide` replaced its `transform.position`-anchored probe with one derived from a
`ClearanceZone`'s polygon, on the stated premise that the polygon's first two corners are always the
face nearest the footprint. That premise is true for `front` alone: a zone rectangle's offset runs
along the local y-axis for `front`/`rear` and the local x-axis for `left`/`right`, and only in the
first case do `rectCorners`' first two entries happen to share an edge. The probe measured `front`
correctly and, on the other three sides, walked parallel to the face or into the machine's own
footprint — live through `scoreLayout`, an obstruction squarely inside a `left` or `right` zone
scored full marks, and a `rear` zone read a false, inflated margin. The regression test written
alongside the original fix asserted only `front`, at rotation 0 and 90°, and could not have caught
this: it is the one side the defect could not touch. Closed by `faceGeometry`, a `geometry.ts`
function that derives a face's anchor, outward normal and lateral extent from the side's own
model-space normal rather than from any polygon's corner order, tested independently across all four
sides, five rotations and both mirror states in `geometry.test.ts`; both `criteria.ts` and
`@mfd/rule-engine`'s clearance evaluator delegate to it rather than either keeping its own geometry.

A third finding, from the same round, went further: even correctly anchored, the probe walked a
*single ray* from the face's own midpoint, so an obstruction anywhere else in the declared clearance
zone — off to one side of centre — was invisible to it and `compliance_margin` reported full marks.
**Owner decision: measure the minimum gap across the whole face**, matching
`@mfd/rule-engine`'s own clearance evaluator (its exported `gapAlongNormal`, from `sat.ts`) and
`measureMaintenanceAccess`'s existing "full containment, not mere overlap" standard, rather than the
centreline. `freeDistanceOnSide` now calls `gapAlongNormal` directly for every other placement and
obstruction in the room — the same function, the same result, rather than a second implementation
free to drift from the rule engine's own finding on identical geometry. The room boundary is not a
polygon "in front of" the face the way an obstruction is, so it is checked at the face's own two
ends (`face.min`/`face.max`) instead: for a convex room, the distance to the boundary along a fixed
direction is a concave function of the starting point along the face, and a concave function over an
interval attains its minimum at one of the interval's endpoints, so the two ends are provably enough
— this does not hold for a concave room outline, which remains an unclosed, pre-existing
imprecision (the room polygon was already reduced to its axis-aligned bounds before this round, and
still is). Regression coverage in `score.test.ts`: the exact scenario the review measured — 3.0
(the ceiling) before the fix, 0.125 after, for an obstruction squarely inside a zone but off-centre.

**Also decided, in the same round: the routing/report anchor point.** `ro_piping_length`,
`electrical_routing`, `walking_distance`, `drain_routing`, `installation_feasibility` (all
`criteria.ts`), the optimiser's nearest-match (`optimise.ts`), and the installation planner's search
extent and routes (`runPlanner.ts`) all measured distance *to* a machine by passing
`placement.transform.position` — the footprint's corner — directly. That was `transform.position`'s
documented meaning, so it was not a contract violation the way the geometry bugs above were, but it
meant a routed distance was measured to a corner nobody chose for that reason, silently
anchor-dependent in a way a report reader had no way to know, and a pure rotation
(`rotatePlacementCommand`) never moved any of these numbers even though the machine visibly swept
elsewhere on the drawing. **Owner decision: the footprint's true centre**, via a new adapter,
`footprintCentre` (`footprintBounds`'s bounding-box midpoint — the same fact `transformForCentre`
solves in the opposite direction). Every call site above, plus the report schedule's position
column, now goes through it; every one falls back to the raw `transform.position` when the catalogue
has nothing for a placement, since a route or a schedule row still needs an answer. Every previously
reported routing/walking score and every printed schedule position has shifted accordingly —
expected, and re-baselined in `score.test.ts`, `optimise.test.ts` and two new tests
(`apps/web/src/features/planning/runPlanner.test.ts`, `packages/report-engine/src/floorPlan.test.ts`),
each guard-broken and restored to confirm it actually discriminates the corner from the centre.
**The Hospital_044 replay does not, and cannot, confirm the routing legs**: the reference dataset
carries no reference points, so `ro_piping_length`/`electrical_routing`/`walking_distance`/
`drain_routing`/`installation_feasibility` all report `SC-901` regardless of anchor and the replay
never reaches `routeAll`. What it does confirm is the report schedule leg alone — its committed
verification record changes by exactly one field, `pdfBytes` (164079 to 164107), isolated to the
schedule's position column printing centre coordinates instead of corner coordinates.

A fourth CTO review of this decision found the same anchor mistake one call site further out:
`apps/web/src/features/layout/ProposalGhostLayer.tsx` drew a "moved" ghost's arrow from
`entry.source.transform.position` (the corner) to the proposed footprint's own centroid — a pure
rotation about a shared corner drew a visible arrow for a machine that, by this decision's own
definition of "moved", had not. Both ends of the arrow now come from the same footprint-centre
computation.

## 4. Deferred / Flagged Decisions

Versions below are those of the TS Edition specification, section 7.

| Item | Position | Why |
| --- | --- | --- |
| Electron | Not in the TS Edition specification | CLAUDE.md lists it as long-term direction; Version 1 is web-only. A thin file-I/O abstraction keeps the door open at near-zero cost. Revisit only if offline hospital use becomes a stated requirement. |
| Three.js | Version 4 (Digital Twin) | Nothing before then is 3D. |
| Python AI service | Version 3 | The TS Edition specification places the AI design assistant in Version 3, later than the generic roadmap assumed. Automatic layout in Version 2 is a constraint solver, not a model. |
| Multi-tenancy / RBAC | Decide before `apps/api` | SaaS vs on-prem changes the auth model, not just a config flag. |
| LLM data residency | Decide before Version 3 | If hospital data cannot leave the network, AD-10's deployment changes fundamentally. |
| DXF / DWG / IFC import | Future, per spec 5.1 | Version 1 imports raster floor plans only. |

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

- [MFD-E_TS_EDITION_SPEC.md](../product/MFD-E_TS_EDITION_SPEC.md) — current scope authority
- [PROJECT_MODEL.md](../data-model/PROJECT_MODEL.md) · [OBJECT_MODEL.md](../data-model/OBJECT_MODEL.md)
- [DEVELOPMENT_ROADMAP.md](../roadmap/DEVELOPMENT_ROADMAP.md) · [MVP_PLAN.md](../roadmap/MVP_PLAN.md)
- [OPEN_QUESTIONS.md](../OPEN_QUESTIONS.md) — blocking unknowns
- [TECH_STACK.md](TECH_STACK.md)
- [CLAUDE.md](../../CLAUDE.md) — long-term vision and engineering principles
