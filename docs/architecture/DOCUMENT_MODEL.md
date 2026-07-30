# Document Model

> The published interface of `@mfd/document-model`.
> Delivered in Sprint 4; extended in Phase 4.5. Schema in
> [../data-model/PROJECT_MODEL.md](../data-model/PROJECT_MODEL.md).

## Why this package exists

Everything the product does next reads one shape:

| Consumer | Reads the document to |
| --- | --- |
| **Save / open** | Put a review on disk and get it back unchanged |
| **Report generation** (Sprint 5) | State what was assessed, on which drawing, against which rules |
| **Collaboration** | Send a project between engineers, and later merge two people's edits |
| **AI-assisted design** | Propose a layout — as commands an engineer could have issued |
| **Digital twin** | Keep a model in step with what was actually installed |

They differ in what they *do* with a project and agree completely on what a project
*is*. So the definition lives in one package that the editor, the report generator and
the server all import. Nothing in it knows about React, Konva, a filesystem, or a clock.

That last one is not fastidiousness. A `createDocument` that called `Date.now()` cannot
be compared against an expected value, cannot be replayed from a command log, and cannot
produce the same bytes twice for a report that is meant to be reproducible. Timestamps
and identifiers are arguments, everywhere.

## The three schema rules

1. **Every field is present.** Unknown values are an explicit `null`, never an omitted
   key. Nothing is `.optional()` — only `.nullable()`. A forgotten field and a recorded
   unknown must not look the same.
2. **Unknown keys are rejected** (`strictObject`). A document written by a newer build
   fails loudly instead of silently dropping the part this build does not understand.
3. **Everything is JSON-safe.** No `Date`, no `Map`, no `undefined`. Timestamps are ISO
   8601 strings, rotations are integer millidegrees. A document is a file before it is
   anything else, and 90° has to survive a round trip as exactly 90,000.

---

## Editing: commands with explicit inverses

```ts
const { document, inverse } = command.apply(before);
inverse.apply(document);   // === before, field for field
```

### Why not snapshots

Snapshot undo is two lines and would be wrong here. A Level embeds its plan image as a
base64 data URL — several megabytes. A snapshot per undo step makes dragging a machine
across a room allocate a hundred megabytes of identical floor plans. An explicit inverse
for a move is two numbers.

### Why the inverse is produced at apply time

Because that is when the prior state is known. Deleting a room needs the deleted room in
order to put it back, and the command that *asked* for the deletion does not carry it.
Producing the inverse during `apply` is what makes `space.delete` reversible at all —
including the machines that were assigned to that room, which are unassigned rather than
deleted and reattached on undo.

### Why commands are data

A command holds ids and values, never a closure over the editor. That is what lets the
history be inspected, a change be logged for a collaborative session, and eventually an
assistant's proposed layout be expressed as the same commands an engineer would have
issued — rather than as a document that appeared from nowhere with no account of how.

### The command set

| Command | Merges | Notes |
| --- | --- | --- |
| `placement.create` | no | |
| `placement.move` | per machine | A drag emits one per pointer move |
| `placement.rotate` | per machine | Rotation normalised into [0, 360,000) |
| `placement.assignSpace` | no | |
| `placement.delete` | no | Restored at its original index — draw order is what an engineer sees when machines overlap |
| `boundary.create` | no | |
| `boundary.setVertices` | per boundary | Replaces the whole ring |
| ↳ move a vertex | **per vertex** | Keyed on `(boundary, index)`, so one drag is one step and two vertices stay apart |
| ↳ insert a vertex | no | Inserted **after** the given index — an edge is identified by the vertex it leaves, so the implied closing edge needs no special case |
| ↳ remove a vertex | no | Declines below three vertices |
| `boundary.describe` | per boundary | Obstruction label and type, in one editing act |
| `boundary.delete` | no | Restored at its original index |
| `space.create` | no | Creates the outline **and** the room, in one step |
| `space.rename` | per room | Typing emits one per keystroke |
| `space.delete` | no | Takes the outline; unassigns its machines rather than deleting them |
| `plan.setOrigin` | no | See below — the one plan operation that *is* a command |
| `level.create` | no | |
| `level.rename` | per level | |
| `level.delete` | no | The most destructive command in the set |

`space.create` is deliberately one command rather than two. A space with no boundary has
no shape and an outline with no space has no name or function; splitting them would let
undo leave one behind.

### Coalescing

Consecutive commands sharing a `mergeKey` become one undo entry: the newest forward
command, and the **oldest** inverse — the one that goes back to before the run began.

**`seal()` is what ends a run, not elapsed time.** The editor seals on pointer-up and on
field blur, which is exact: one gesture is one undo step, however long it took or how
slowly its frames arrived.

`MERGE_WINDOW_MS` is a safety net for a run that never seals. It is 2 seconds, and was
briefly 300 ms — which looked reasonable and was too tight. A drag re-evaluates a few
hundred findings per pointer move, so one slow frame would split the drag into two undo
steps, and undo would behave one way on an idle machine and another on a loaded one with
nothing anywhere saying so.

### What is deliberately outside undo

**Importing a plan, and setting its scale.** Undoing a scale change would leave every
placement at a millimetre position derived from a mapping that no longer exists —
geometry silently reinterpreted, which is the failure mode this product exists to
prevent. Both are explicit, deliberate acts, and both are re-doable by repeating them.

### The plan origin *is* a command, and why that is not a contradiction

Setting the origin does not reinterpret anything. It declares which image pixel is model
(0, 0) and **translates every placement and boundary vertex by the same delta**, so each
of them stays over the pixel of the drawing it was over before. The coordinates renumber;
the layout does not move. Translating back by the same delta restores the document field
for field, which is what makes it safely undoable when a scale change is not.

Two consequences worth knowing about:

- On an empty level — the ordinary case, since the origin is set right after calibration
  — the translation is a no-op. It earns its keep when the origin is set *late*, which is
  exactly when getting it wrong would be hardest to notice.
- The plan image moves in model space too, by the same delta, so relative to each other
  nothing changes. Relative to the **viewport** everything moves together, which on screen
  looks like the whole floor sliding. The editor therefore pans the view to compensate —
  stated as a rule over the before-and-after origins rather than as a special case in one
  action, because undo and redo change the origin too, and a compensation applied on the
  way in but not on the way out is the same bug with an extra keystroke in front of it.

### Refusals are no-ops, not exceptions

Three commands decline rather than throw:

| Command | Declines when | Why not throw |
| --- | --- | --- |
| `removeBoundaryVertexCommand` | The ring is already at three vertices | A two-vertex "room" would report every machine in the building as outside it |
| `deleteLevelCommand` | It is the last level | A project with no floor is not a project, and the schema requires one |
| `setPlanOriginCommand` | The level has no coordinate mapping | There is nothing to be the origin of until a scale exists |

Each still records an inverse, so the history stays consistent whether the edit took
effect or not. A UI that offers an impossible control is the thing to fix; crashing the
editor is not how to report it. `canRemoveBoundaryVertex` and `canDeleteLevel` let a
caller disable the control instead of offering a no-op.

### Depth

200 entries. Each is a pair of small command objects, so the cap bounds a session that
runs all day rather than relieving memory pressure. Snapshot undo would have needed a cap
two orders of magnitude tighter.

---

## The plan transform

```
model_mm = rotate(image_px − origin, rotation) × millimetresPerPixel
```

Lives in `@mfd/cad-engine` as `PlanTransform` — it is geometry, not rendering (AD-2), and
the server needs it as much as the browser (AD-3). `CoordinateMapping` in the document is
that transform plus its provenance: the calibration evidence and when it was made.
Nothing that computes needs the provenance, so it is dropped at the boundary.

All three parts are required together. Scale alone is not a coordinate system: without an
origin there is nothing to measure *from*, and without a rotation a plan scanned three
degrees off square puts every clearance three degrees off. Hospital floor plans do not
arrive square to the page.

### Calibration refuses rather than approximates

`calibrateFromTwoPoints` returns `null` for two identical points or a distance of zero. A
level that looks calibrated but measures nonsense is strictly worse than one that is
honestly uncalibrated, because only the second one tells anybody.

---

## Polygon geometry

Written in `@mfd/cad-engine`, not imported. Owner decision — no external CAD geometry
library — and the reason it was the right call is narrower than "fewer dependencies":

**Rooms are not convex.** The rule engine's separating axis test is convex-only, and an
L-shaped treatment area is the ordinary case rather than the exception. SAT reports a
machine standing in the notch of an L as *inside* the room — a false pass on exactly the
geometry an engineer is most likely to get wrong. Containment is therefore ray casting
(the crossing-number rule), which does not care about convexity.

The other reason: every general-purpose library brings a coordinate convention, a
tolerance policy and a floating-point epsilon of its own. Those three decisions are what a
millimetre-accurate clearance verdict rests on. They are made in `polygon.ts`, in the
open.

Conventions:

- A polygon is a **closed ring given as its distinct vertices**. The closing edge is
  implied, never stored.
- **Winding order is not significant.** An engineer drawing a room clockwise and one
  drawing it anticlockwise get the same room.
- A point **on** the outline is inside. A machine flush against a wall is in the room;
  whether it is too close to that wall is a clearance question, and answering it in two
  places would let the two answers diverge.

---

## Save and load

`.mfd.json`. The version is read first, from a deliberately loose schema, before the
document is parsed — because a file from a newer build fails `strictObject` on fields this
build has never heard of, and that failure would read as "your project file is corrupt",
which is both alarming and false.

A document from the future is **refused**. Opening it anyway would drop everything this
build does not understand the moment the engineer saved, over their only copy.

The document is validated on the way **out** as well as in. An editor bug that produced an
invalid document would otherwise be discovered by the engineer who tried to reopen the
file, long after the state that caused it was gone.

### Migration

`DOCUMENT_VERSION` is **4**. Three real steps:

| Step | Added in | Does |
| --- | --- | --- |
| v1 → v2 | Phase 4.5 | Adds `obstructionType` to every boundary: `null` for room outlines and walls, `"other"` for anything already marked `kind: "obstruction"` |
| v2 → v3 | Sprint 5 | Adds `project.settings` with `reportRenderMode: "vector"` — the default, and the only mode that does not depend on a raster being present |
| v3 → v4 | Sprint 6 | Adds `referencePoints: []` to every level. **An empty array, and nothing else** — see below |

A v1 obstruction says something is in the way and nothing about what. `"other"` records
that honestly; guessing `"column"` would be an invention the engineer would then have to
notice was wrong.

### Version 4

Sprint 6 adds **`Level.referencePoints`** — where the services enter a level, where equipment is
delivered onto it, and where staff work from, as model millimetres:

```ts
interface ReferencePoint {
  id: string;
  kind: 'ro_supply' | 'ro_return' | 'drain' | 'electrical_panel' | 'data';
  position: Vec2;
  label: string | null;
}
```

**Why the document needs it rather than the solver holding it.** Four of the criteria the layout
scoring engine ranks on — 40 % of the approved weights — are distances *from* one of these points
([AI_WORKFLOW.md § D](AI_WORKFLOW.md)). A distance from a position nobody recorded is not a
measurement, so the positions belong in the document an engineer saves, alongside the geometry they
are measured against — and they are placed with an undoable command like everything else.

The v3 → v4 migration gives every existing level an **empty** array. That is the honest value: no
engineer has placed an origin, so the scoring engine reports those criteria `unavailable` rather than
computing a distance from an assumed point. A migration that guessed a panel location on the nearest
wall would produce a number in a report from an invention (AD-18).

Two things the first real migration taught, both fixed:

1. **`parseDocument` was migrating the content and leaving the version stamp alone.** The
   file on disk was always written correctly, because `saveDocument` restamps — so nothing
   on disk would ever have shown it. The in-memory document claimed v1 while holding v2
   content, and every later consumer would have been reading a document that lied about
   its own shape.
2. **A migration takes unvalidated JSON by necessity**, because the type it would want is
   the *old* schema, which this build no longer has. So it has to survive a shape that is
   not what it expects and fail at the schema check that follows — not with a `TypeError`
   halfway through. There is a test for exactly that.

A test asserts that every version step below the current one has a migration, so bumping
`DOCUMENT_VERSION` without writing one fails the build rather than an engineer's reopened
project.

---

## What this makes possible next

| Need | What is already here |
| --- | --- |
| **Report** | A document that states its rule set, its drawing, and the calibration evidence behind every measurement |
| **Server persistence** | A JSON-safe document with a version and a migration chain |
| **Collaboration** | Commands as data — an edit log is the same objects the editor already produces |
| **AI-assisted layout** | An assistant proposes commands, so its work is reviewable and undoable like anyone else's |
| **Digital twin** | `Level` already separates as-drawn geometry from the catalogue record it points at |

None of those are built. The point of listing them is that each one reads this shape, and
the shape was chosen with them in view rather than being generalised later under pressure.
