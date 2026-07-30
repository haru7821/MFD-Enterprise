# Project Model

> The document a TS engineer creates, saves and reports on.
> Governed by [MFD-E_TS_EDITION_SPEC.md](../product/MFD-E_TS_EDITION_SPEC.md).
> Version 0.3 — implemented in Sprint 4 as `packages/document-model`; obstruction typing
> added in Phase 4.5. **Document schema version 2.**

## Hierarchy

```
Project
 └ Level                          a floor: owns its plan image and calibration
     ├─ planImage                 the imported PDF / PNG / JPG, embedded
     ├─ coordinateMapping         scale · origin · rotation, null until calibrated
     ├─ boundaries[]              traced geometry: room outlines, walls, obstructions
     ├─ spaces[]                  named rooms, each referring to a boundary
     └─ placements[]              machines, each with a nullable spaceId
                                   └ Equipment Object Reference
```

The chain ends at the **Equipment Object Reference** — a pointer into the catalogue, not
a copy of it. A Project owns its Levels and a Level owns everything on it; a Placement
*refers to* an Equipment Object that lives outside the project entirely. See
[OBJECT_MODEL.md](OBJECT_MODEL.md) for why that separation is load-bearing.

**Port is a property of Placement, not a level of the hierarchy.** Ports are derived from
the equipment object definition and positioned by the placement's transform; they are not
independently owned or addressed.

### Two departures from version 0.1, both deliberate

**Placements hang off the Level with a `spaceId`, rather than off the Space.** Version 0.1
made a Space own its Placements. Building it showed two problems with that. An engineer
places a machine and then draws the room around it at least as often as the reverse, and a
machine that cannot exist until its room does would block the commoner order of work. And
a machine has to survive its room being deleted — losing equipment because a room outline
was redrawn is not a recoverable mistake. So room membership is a reference that may be
null, not an ownership chain.

**Boundary is its own entity, not a field on Space.** A structural column, a duct riser or
a fixed partition is a real obstruction with no room-hood at all. Folding boundaries into
Space would have meant either inventing a fake room for every column or having no way to
represent one.

---

## Project

The unit a TS engineer opens, saves and reports on. One hospital installation review.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `documentVersion` | integer | On the **file**, outside `project`, so a loader can read it before trusting anything else. Starts at 1; the loader migrates forward and refuses a version from the future. |
| `name` | string | e.g. "Seoul St. Mary's — 3F dialysis unit" |
| `customer` | object | Hospital name, site, contact |
| `reviewedBy` | string | The TS engineer. Appears on the report. |
| `createdAt` / `updatedAt` | timestamp | |
| `ruleSetRef` | object | `{ id, version }` of the rule set used. **Stamped into every saved project and every report.** |
| `settings` | object | Sprint 5, `DOCUMENT_VERSION` 3. Currently `reportRenderMode`; the place where an owner-chosen output choice lives rather than being a render-time argument. |
| `levels` | Level[] | At least one |

`ruleSetRef` is not bookkeeping. A report that says "compliant" without recording which
rules and which manual revision produced that verdict cannot be defended six months later
when the manual has been revised.

## Level

A floor. Owns the imported drawing and its calibration, because both are properties of
that floor rather than of the view.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `name` | string | e.g. "3F" |
| `elevation` | Millimetres | Height above project datum. 0 for a single-level project. |
| `planImage` | PlanImage \| null | The imported floor plan. Null before import. |
| `coordinateMapping` | CoordinateMapping \| null | **Null until mapped.** |
| `boundaries` | Boundary[] | Traced geometry |
| `spaces` | Space[] | Named rooms |
| `placements` | Placement[] | Machines on this floor |
| `referencePoints` | ReferencePoint[] | **Planned, Sprint 6** — `DOCUMENT_VERSION` 4. Where the services enter this floor. |

### ReferencePoint — planned, not implemented

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `kind` | `ro_supply` \| `ro_return` \| `drain` \| `electrical_panel` \| `data` | |
| `position` | Vec2 | Model millimetres, like all geometry |
| `label` | string \| null | e.g. "Panel DB-3F-2". Null when the engineer has not named it. |

A property of the **floor**, for the same reason the plan image is: an electrical panel is at a
place on a floor, not in a view. Sprint 6's layout scoring engine ranks RO piping length, drain
routing and electrical routing, and each of those is a distance *from* one of these points — a
distance from a position nobody recorded is not a measurement, so the positions have to be part of
the document an engineer saves and a report cites.

**An empty array is the correct state, not an incomplete one.** Existing projects migrate to `[]`,
and until an engineer places an origin those criteria report `unavailable`. Inferring a panel
position from the drawing, or defaulting to the nearest wall, would put a number in a report that
nobody measured. See [../architecture/AI_WORKFLOW.md § D](../architecture/AI_WORKFLOW.md).

### PlanImage

The imported drawing, as pixels. Carries no notion of real-world size.

| Field | Type | Notes |
| --- | --- | --- |
| `sourceFormat` | `pdf` \| `png` \| `jpg` | |
| `sourceFileName` | string | Shown in the report so the reviewer knows which drawing was assessed |
| `pageIndex` | integer | PDF only; 0 for raster imports |
| `pixelWidth` / `pixelHeight` | integer | |
| `dataUrl` | string | The image itself, base64. See below. |
| `importedAt` | timestamp | |

The image is **embedded, not referenced by path**. A project file an engineer emails to a
colleague has to arrive with its drawing; a path into someone else's filesystem is not a
floor plan. External asset storage is a later decision.

The cost is worth stating: a large scanned plan becomes several megabytes of base64 inside
the project file. That is precisely why undo stores explicit inverses rather than document
snapshots — see [../architecture/DOCUMENT_MODEL.md](../architecture/DOCUMENT_MODEL.md).

A PDF page is **rasterised on import** and then treated exactly like a PNG. Sprint 4's
scope is a raster underlay the engineer works on top of; the vector content is not read, so
nothing downstream can come to depend on it being there.

### CoordinateMapping

The complete transform between image pixel space and model millimetre space. Delivered in
Sprint 4 (spec 5.1 and the "Scale Setting" item of 5.2).

| Field | Type | Notes |
| --- | --- | --- |
| `millimetresPerPixel` | number | **Scale** — how large the drawing is |
| `origin` | Vec2 | **Position** — the image pixel that is model (0, 0) |
| `rotation` | integer | **Orientation** — millidegrees; drawings are not always square to the scan |
| `calibration` | ScaleCalibration | How `millimetresPerPixel` was arrived at |
| `mappedAt` | timestamp | |

Scale alone is not a coordinate system. A drawing can be correctly scaled and still be
unusable: without an origin there is nothing to measure *from*, and without a rotation a
plan scanned three degrees off square puts every clearance measurement three degrees off.
Hospital floor plans do not arrive square to the page.

Deriving the mapping:

```
model_mm = rotate(image_px − origin, rotation) × millimetresPerPixel
```

This is the inverse of what the canvas already does for the viewport (AD-2), and lives in
`cad-engine` for the same reason: it is geometry, not rendering.

### ScaleCalibration

The evidence behind `millimetresPerPixel`, kept so a reviewer can see how the scale was
established rather than having to trust it.

| Field | Type | Notes |
| --- | --- | --- |
| `method` | `two-point` \| `stated-ratio` | |
| `pointA` / `pointB` | Vec2 | The two points the engineer picked, in image pixels |
| `knownDistance` | Millimetres | The real distance the engineer typed |
| `statedRatio` | string \| null | e.g. "1:100", when the drawing declares its own scale |
| `dotsPerInch` | number \| null | The resolution a stated ratio was applied at |
| `calibratedAt` | timestamp | |

Every field is present and nullable: a two-point calibration has no `statedRatio`, and
saying so with `null` is different from omitting the key.

**An unmapped Level cannot be validated.** A layout on a plan with
`coordinateMapping === null` can never reach GREEN. Measuring screen distance and calling
it a clearance is the single most damaging thing this application could do, so it is
blocked structurally rather than by a warning somebody can dismiss.

How that is enforced, precisely — the rule engine is told the plan's status and gates the
report on it:

| `planStatus` | Means | Effect on the report |
| --- | --- | --- |
| `none` | No drawing imported; the engineer works directly in millimetres | None. This geometry is exact. |
| `calibrated` | A drawing with a mapping | None |
| `uncalibrated` | A drawing with no mapping | Every GREEN becomes YELLOW. **RED stays RED.** |

`none` is not a weaker case than `calibrated`. An engineer laying a room out in
millimetres with no drawing behind it has exact geometry; it is the half-imported plan that
is dangerous, because it *looks* like a measured drawing. And a violation is never softened
for weak provenance — that would make poor data hide problems.

## Boundary

A traced polygon in model space. Its own entity, because not every piece of building
geometry is a room.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `kind` | `space_outline` \| `wall` \| `obstruction` | What the rule engine does with it |
| `vertices` | Vec2[] | Closed ring, millimetres. At least three. |
| `label` | string | e.g. "Column C4" |
| `obstructionType` | ObstructionType \| null | `column` · `shaft` · `duct` · `fixed_equipment` · `other`. Required when `kind` is `obstruction`, and rejected otherwise. |

**`obstructionType` is descriptive, not behavioural.** The rule engine asks one question —
is this a room outline, or something equipment must not overlap — and that is `kind`. The
type exists so a report can say "overlaps Column C4" rather than "overlaps obstruction 3",
and so a floor's obstructions can be grouped and counted.

Keeping the two apart is what stops a new type needing an evaluator change, and stops an
unrecognised type silently ceasing to be checked.

The ring is **closed implicitly** — the closing edge is never stored, so "is this ring
closed" has one answer rather than two.

| `kind` | Equipment must |
| --- | --- |
| `space_outline` | be **inside** it |
| `wall`, `obstruction` | **not overlap** it |

## Space

A room. The scope most rules select on.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `name` | string | e.g. "Treatment area A" |
| `function` | SpaceFunction | Controlled vocabulary — see below |
| `boundaryId` | string | The Boundary that gives this room its shape |

### SpaceFunction

A controlled vocabulary, not free text, because rules select on it. Initial set for the
dialysis MVP:

`hemodialysis_treatment` · `isolation_treatment` · `water_treatment` ·
`clean_utility` · `soiled_utility` · `staff_station` · `storage` · `corridor` · `other`

Extending this list is a deliberate act with rule consequences. A free-text field would
let "Treatment Rm" and "treatment room" become two different things that no rule matches.

## Placement

One machine on one drawing.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `equipmentObjectId` | string | Reference into the catalogue, e.g. `vantive_ak98` |
| `equipmentObjectVersion` | string | The catalogue version placed. Lets a report state exactly which data was used. |
| `transform` | Transform | Position and rotation in model space |
| `label` | string | e.g. "Station 12" |
| `spaceId` | string \| null | The room this machine is assigned to. Null when it sits in no named room. |
| `ports` | Port[] | Derived from the object definition, positioned by the transform. Not stored. |

Room assignment is **by reference, not by geometry**, and the two are allowed to disagree:
an engineer may place a machine before drawing the room, or drag one across a wall
mid-review. The rule engine reports on the geometry; `spaceId` records the intent.

### Transform

| Field | Type | Notes |
| --- | --- | --- |
| `position` | Vec2 | Millimetres |
| `rotation` | integer | Millidegrees, to keep 90° rotations exact |
| `mirrored` | boolean | Some installations are handed |

### Port

A service connection point, derived from the Equipment Object and placed by the transform.

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `power` \| `ro_water` \| `drain` | |
| `position` | Vec2 | Model space, after transform |
| `connected` | boolean | Set by connection validation in Sprint 3 |

---

## Design notes

**Millimetres throughout.** Every length in this model is millimetres in model space, per
AD-1. Image pixels appear only inside `PlanImage` and `ScaleCalibration`, and exist to be
converted out of.

**Schema versioning from v1.** `schemaVersion` and a migration chain exist from the first
saved file. Adding versioning after real project files exist means either breaking them or
writing the migration you skipped, under pressure.

**Undo/redo is a command stack over this model**, not a snapshot diff — see AD-8 and
[../architecture/DOCUMENT_MODEL.md](../architecture/DOCUMENT_MODEL.md).

**Not in this model:** validation results. Those are computed, never stored in the
project. A stored verdict goes stale the moment a rule set or a placement changes, and a
stale verdict in a feasibility report is worse than no verdict.

## Implementation status

| Element | Sprint | Status |
| --- | --- | --- |
| Equipment Object, Placement | 2 | ✅ |
| Level, Boundary, Space, Space function vocabulary | 4 | ✅ |
| PlanImage, CoordinateMapping, ScaleCalibration | 4 | ✅ |
| Project, save / load, document versioning | 4 | ✅ |
| Command stack (undo / redo) | 4 | ✅ |
| `obstructionType`, plan origin as a command, level commands | 4.5 | ✅ |
| Document migration v1 → v2 | 4.5 | ✅ the first real one |
| Port | after the routing model | declared, not derived yet |
| Placement `parameters` (per-instance overrides) | when an object declares one | not modelled |
| Multiple levels in the UI | 4.5 | ✅ level selector, add, rename, delete |
