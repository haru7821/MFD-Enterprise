# Phase 4.5 — UX Completion

> Between Sprint 4 (plan workflow and spatial model) and Sprint 5 (report generation).
> Scope set by the product owner: origin placement, boundary vertex editing, obstruction
> objects, level switcher.

## Verdict

**Complete.** All four items are delivered, tested and documented, plus a fifth change the
owner added afterwards: separating manufacturer dimensions from the design footprint.
394 unit tests and 64 browser specs pass; typecheck, lint and production build are clean.

Phase 4.5 was described as finishing the interface, and most of it was. But building the
gestures turned up **five defects and one incomplete model decision** that the model-level
work had not exposed — recorded below, because each one was invisible until a hand moved a
mouse.

---

## 1. Origin placement by mouse click

`setPlanOriginCommand` · `origin/start` · `origin/set` · Plan panel step 3.

### What it does

The engineer clicks the point on the drawing that is model (0, 0). The point's coordinate
readout becomes zero. **Nothing moves.**

### Why that took a command rather than a setter

Setting the origin changes where the *drawing* sits in model space, so on its own it would
slide the plan out from under every machine already placed on it. That is not what "set the
origin here" means — it means *call this point zero*: the layout stays where it is on the
drawing, and the coordinates renumber.

So the command translates every placement and every boundary vertex by the same delta.
Each one ends over the same pixel of the plan it was over before, and translating back by
the same delta restores the document field for field — which is what makes this safely
undoable when a scale change is not.

On an empty level, the ordinary case, the translation is a no-op. It earns its keep when
the origin is set *late*, which is exactly when getting it wrong would be hardest to
notice.

### The incomplete decision this exposed

Document geometry moves by −delta; so does the plan image. **Relative to the viewport,
everything moves together** — on screen, the whole floor slides the moment an engineer
clicks a point. The first implementation did exactly that.

Fixed by panning the view to compensate. Stated as a rule over the before-and-after
origins — *whenever the active level's plan origin changes, the view moves with it* —
rather than as a special case inside the one action. Undo and redo change the origin too,
and a compensation applied on the way in but not on the way out is the same bug with an
extra keystroke in front of it.

`planOriginShift` is exported from `@mfd/document-model` so the command and the editor
share one piece of arithmetic. Duplicating it is how the picture and the coordinates come
to disagree.

## 2. Boundary vertex editing

`moveBoundaryVertexCommand` · `insertBoundaryVertexCommand` · `removeBoundaryVertexCommand`
· vertex hit-testing in `useCanvasInteraction` · handles in `SpaceLayer`.

| Action | Gesture |
| --- | --- |
| Select | Click a boundary, then a vertex handle |
| Drag | Drag the handle. One drag is one undo step |
| Insert | Click an edge midpoint handle, and keep dragging — insert and position are one gesture |
| Delete | Select a vertex, press Delete. Refused at three vertices |
| Snap | Grid, plus a stronger pull onto **other boundaries'** vertices |

### Why insertion is "after an index"

The caller has hit-tested an *edge*, and an edge is identified by the vertex it leaves.
Inserting "at" an index would make the implied closing edge the awkward special case it
does not need to be.

### Why vertex snapping pulls onto other rings, not its own

Two rooms sharing a party wall have to share its coordinates **exactly**. Getting them
within a few millimetres by eye leaves a sliver of floor belonging to neither room, and the
containment test would then place a machine near that wall in neither of them. So a dragged
vertex snaps onto a neighbouring boundary's vertex in preference to the grid.

Its own ring is excluded: snapping a vertex onto its own neighbour collapses the edge
between them, which `simplifyPolygon` would then quietly delete.

The spec for this checks the **saved document**, not the screen. "Exactly" is a claim about
coordinates, and only the file can settle it.

### The defect this exposed

**Handles were drawn while a tracing tool was still armed.** After a ring closes the room
tool stays armed, so several rooms can be traced in a row — which meant the handles on the
just-finished room were visible and dead: a click started the next ring instead of grabbing
a handle.

Fixed by drawing handles only when a tracing tool is *not* active, and saying "press V to
reshape it" in the inspector while it is. A UI that lies about what a click will do is
worse than one with no handles at all.

## 3. Obstruction objects

`OBSTRUCTION_TYPES` · `createObstruction` · `describeBoundaryCommand` · obstruction tool
(**O**) · `ObstructionInspector`.

Columns, shafts, ducts, fixed equipment and other. Traced like a room, but producing a bare
`Boundary` with no room record — a column is not a room, and giving it one would be a
fiction the rule engine and the report would both have to work around.

### `obstructionType` is descriptive, not behavioural

The rule engine asks one question — is this a room outline, or something equipment must not
overlap — and that is `kind`. The type exists so a report can say "overlaps Column C4"
rather than "overlaps obstruction 3".

Keeping the two apart is what stops a new type needing an evaluator change, and stops an
unrecognised type silently ceasing to be checked.

The schema enforces it both ways: an obstruction **requires** a type, and anything else
**refuses** one. An obstruction with no type produces a report row an engineer cannot act
on; a room outline carrying one is a record that two different things were meant, with no
way to tell which.

### On "do not evaluate them yet"

The scope note asked for obstructions to be stored but not evaluated. **They were already
evaluated** — the `BoundaryCollisionEvaluator` delivered in Sprint 4 checks equipment
against every boundary whose `kind` is not `space_outline`, with 21 unit tests behind it.
Only the drawing was missing.

So Phase 4.5 added the drawing and **no new evaluation logic**, which is the reading that
leaves the feature useful. Removing the working, tested evaluation would have produced an
obstruction an engineer can draw and nothing checks — the exact failure mode the rest of
this product is built to avoid. Flagged to the owner rather than done silently.

Browser spec B5 is the one that proves the two halves meet: a machine standing on a traced
column reports RED.

## 4. Level switcher

`createLevelCommand` · `renameLevelCommand` · `deleteLevelCommand` · `LevelPanel`.

A `<select>` rather than tabs: a hospital wing runs to more floors than a tab strip holds,
and a strip that scrolls sideways is worse than a list that does not.

Switching levels clears every selection. Carrying them across would leave the inspector
describing something the engineer can no longer see.

**Deleting a level is the most destructive command in the set**, which is exactly why it is
a command. A floor holding fifty machines and a calibrated plan is restored whole, at its
original position in the level order. Undo is a better answer than a confirmation dialogue
nobody reads — and it is the answer for the case a dialogue cannot cover, which is meaning
to say yes and being wrong about which floor was selected.

The last level cannot be deleted. `canDeleteLevel` disables the control, and the command
declines as a no-op if it is called anyway.

---

## Document schema version 2

`obstructionType` is a new required field, so the schema version moved to **2** and the
migration chain got its first real step.

| Step | Does |
| --- | --- |
| v1 → v2 | `obstructionType`: `null` for room outlines and walls, `"other"` for anything already `kind: "obstruction"` |

A v1 obstruction says something is in the way and nothing about what. `"other"` records
that honestly; guessing `"column"` would be an invention the engineer would then have to
notice was wrong.

### Two defects the first real migration exposed

1. **`parseDocument` migrated the content and left the version stamp alone.** The
   in-memory document claimed v1 while holding v2 content. The file on disk was always
   written correctly, because `saveDocument` restamps — which is why this is worse than it
   sounds: nothing on disk would ever have shown it, and every later consumer would have
   been reading a document that lied about its own shape.
2. **A migration receives unvalidated JSON by necessity** — the type it would want is the
   old schema, which this build no longer has. It has to survive a shape that is not what
   it expects and fail at the schema check that follows, not with a `TypeError` halfway
   through. There is now a test for exactly that.

Both were found by writing the migration's tests, not by running the application. This is
the case for having built the versioning mechanism in Sprint 4 rather than when it was
first needed.

---

## 5. Manufacturer dimensions separated from design footprint

Owner decision, taken after the four scope items were delivered.

### The change

| | `manufacturerDimensions` | `designFootprint` |
| --- | --- | --- |
| What | What the product measures | The area a plan reserves |
| Authority | The installation manual (AD-6) | The reviewing organisation's planning standard |
| Read by | The report only | **Canvas, placement, collision, and auto-layout when it exists** |
| Nullable | Every field | No — width and depth required |
| Mutable | **Never** | A revisable planning decision |

| Object | Manufacturer | Design footprint |
| --- | --- | --- |
| Vantive AK98 | 585 × 620 × 1305 mm | 800 × 800 mm |
| Dialysis Bed | — none | 1,000 × 2,100 mm |

`localFootprintRect` — the single function every geometric path goes through — now reads
`designFootprint`. Nothing else needed changing, which is the payoff of having had one
place where a footprint became geometry.

### What this fixed that was already broken

The catalogue had a single `dimensions`, and it was doing both jobs. Its value was
900 × 750 mm, taken from the object specification where it is marked **"Example"** — a
placeholder standing in as both the product's size and the planning area.

The failure mode is specific and quiet: the first time a planner rounds a footprint up to
make a layout work, the manufacturer's measurement is gone, and the record can no longer be
checked against the machine that arrives on site. Nothing would have flagged it.

### Three things this forced

**`manufacturer` became nullable.** A dialysis bed planned at 1,000 × 2,100 mm is a
footprint, not a product. Forcing a string would have meant inventing a manufacturer that a
report would then repeat as fact.

**`designFootprint.basis` was added** — one nullable sentence saying why this area. Not in
the owner's list, and I added it because a report printing "800 × 800" with no account of
where it came from invites a question it cannot answer, and an unsourced number is exactly
what the rest of this product refuses.

**`verified` now requires `basis`.** This closes the hole the split would otherwise open: a
record whose *manufacturer* figures are sourced but whose *planning* area is not could
carry an unaccounted-for footprint into GREEN — and the footprint is what every clearance
and collision check actually measures (AD-6a).

### The AK98 record is still `draft`, deliberately

The dimensions are now real. The **citation is not**: no document, no revision, no section
— and the service clearances are still null. `verified` means citable, not correct, so the
record stays `draft` and nothing computed from it can reach GREEN.

`source.type` moved from `estimate` to `datasheet`, which describes owner-supplied
manufacturer figures better than "estimate" did without claiming a manual has been read.
Flagged as an open question in the AK98 spec addendum.

### Verified by breaking it

`localFootprintRect` was temporarily pointed at `manufacturerDimensions`: **10 of 18
geometry tests failed**, including the two written specifically for the split. The browser
dimension test independently pins it — the AK98 draws 800 × 800 on screen at every zoom,
and 800 is not 585.

The bed's dimension spec is the complementary case: 1,000 × 2,100 is not square, so it also
proves width and depth are not being read from the same field.

---

## Defects found and fixed

Six, five of them only reachable through a gesture:

| # | Defect | How it surfaced |
| --- | --- | --- |
| 1 | Setting the origin slid the whole floor on screen | Writing the origin spec |
| 2 | Undo of an origin change did not pan the view back | The undo spec, after fixing 1 |
| 3 | Vertex handles drawn while a tracing tool was armed, so they were visible and dead | Two vertex specs failing for one reason |
| 4 | The obstruction inspector reported a **room's** vertex count, so two panels described one fact | A strict-mode selector collision |
| 5 | `parseDocument` left the version stamp unmigrated | The migration test |
| 6 | `equipment.spec.ts` read the canvas one frame early and flaked under parallel load | A full-suite run, once in five |

Defect 6 is a pre-existing spec, not new work — the same repaint race found in Sprint 4,
in a place it had been missed. Reading a canvas straight after an input event measures the
previous frame; `expect.poll` retries, a bare `page.evaluate` does not. Five consecutive
clean full-suite runs since.

## Tests that were verified to fail

Both new specs whose logic is subtle enough to be wrong silently:

| Spec | Broken by | Result |
| --- | --- | --- |
| "picks the origin … renumbers the coordinates" | Zeroing the viewport compensation | Failed ✅ |
| "snaps a dragged vertex onto a neighbouring room's corner" | Disabling vertex snapping | Failed ✅ |

Plus one at the unit level:

| Test | Broken by | Result |
| --- | --- | --- |
| "leaves a machine over the same pixel … on a rotated plan" | Flipping the rotation sign in `originShift` | Failed ✅ |

That last one replaced a round-trip test that **could not** catch the error. `apply` then
`inverse` recomputes its own delta with the same convention, and `delta(A→B) = −delta(B→A)`
whichever way the rotation is applied — so the signs always cancel and the round trip is
green either way. What pins it down is the forward direction, checked against
`pixelToModel` rather than against the command's own arithmetic.

Two attempts at verifying the negative also failed for a reason worth recording: `pnpm
build` runs typecheck first, so an edit that broke compilation left the previous bundle in
place and the specs passed against unchanged code. A negative check has to confirm the
build actually changed.

## Quality gates

| Gate | Result |
| --- | --- |
| Unit tests | **394** (was 362) |
| Browser specs | **64** (was 40) |
| Typecheck | Clean, strict, six packages |
| Lint | Clean |
| Production build | Clean |
| Full e2e suite | 5 consecutive clean runs |

New tests by area:

| Area | Unit | Browser |
| --- | --- | --- |
| Origin re-datum, including the rotated forward invariant | 9 | 5 |
| Vertex editing | 7 | 5 |
| Obstructions — typing, schema refusals, describing | 1 | 5 |
| Levels | 5 | 6 |
| v1 → v2 migration | 6 | — |
| Console-clean load | — | 1 |
| Manufacturer / design footprint split | 4 | 2 |
| **Total** | **32** | **24** |

## Deliberately not done

| | Why |
| --- | --- |
| Plan **rotation** UI | Not in the scope list. The transform carries it, `rotationFromReferenceLine` derives it, and the panel reads it out — but there is no gesture. It has the same "everything slides" property as the origin did, so when it gets a UI it needs the same compensation. |
| Multi-select | Not in the scope list, and not obviously wanted: a review edits one thing at a time. |
| Wall tracing | `kind: 'wall'` is modelled and evaluated. Nothing draws one, because a wall is a linear thing and the tracing tool makes closed rings — a wall tool wants thickness and a centreline, which is its own small design. |
| Elevation editing | `Level.elevation` is in the model and settable through the API, with no field in the panel. It matters when levels are stacked, which nothing yet does. |
