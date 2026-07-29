# Project Model

> The document a TS engineer creates, saves and reports on.
> Governed by [MFD-E_TS_EDITION_SPEC.md](../product/MFD-E_TS_EDITION_SPEC.md).
> Version 0.1 — Sprint 1.5. Not yet implemented; Sprint 2 builds the first part of it.

## Hierarchy

```
Project
 └ Level
     └ Space
         └ Placement
             └ Equipment Object Reference
```

The hierarchy ends at the **Equipment Object Reference** — a pointer into the catalogue,
not a copy of it. That is the last link in the ownership chain: a Project owns its Levels,
a Level its Spaces, a Space its Placements, and a Placement *refers to* an Equipment Object
that lives outside the project entirely. See [OBJECT_MODEL.md](OBJECT_MODEL.md) for why
that separation is load-bearing.

**Port is a property of Placement, not a level of the hierarchy.** Ports are derived from
the equipment object definition and positioned by the placement's transform; they are not
independently owned or addressed.

Two things hang off `Level` as properties rather than children — the imported plan and its
coordinate mapping:

```
Level
 ├─ planImage           the imported PDF / PNG / JPG
 └─ coordinateMapping   origin · rotation · millimetresPerPixel
```

---

## Project

The unit a TS engineer opens, saves and reports on. One hospital installation review.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `schemaVersion` | integer | Starts at 1. Every saved file carries it, and the loader migrates forward. |
| `name` | string | e.g. "Seoul St. Mary's — 3F dialysis unit" |
| `customer` | object | Hospital name, site, contact |
| `reviewedBy` | string | The TS engineer. Appears on the report. |
| `createdAt` / `updatedAt` | timestamp | |
| `ruleSetRef` | object | `{ id, version }` of the rule set used. **Stamped into every saved project and every report.** |
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
| `spaces` | Space[] | |

### PlanImage

The imported drawing, as pixels. Carries no notion of real-world size.

| Field | Type | Notes |
| --- | --- | --- |
| `sourceFormat` | `pdf` \| `png` \| `jpg` | |
| `sourceFileName` | string | Shown in the report so the reviewer knows which drawing was assessed |
| `pageIndex` | integer | PDF only |
| `pixelWidth` / `pixelHeight` | integer | |

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
| `calibratedAt` | timestamp | |

**An unmapped Level cannot be validated.** Any rule evaluated against a plan with
`coordinateMapping === null` returns YELLOW with the reason "plan not calibrated" — never
GREEN. Measuring screen distance and calling it a clearance is the single most damaging
thing this application could do, so it is blocked structurally rather than by a warning.

## Space

A room. The scope most rules select on.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `name` | string | e.g. "Treatment area A" |
| `function` | SpaceFunction | Controlled vocabulary — see below |
| `boundary` | Vec2[] | Closed polygon, millimetres, model space |
| `placements` | Placement[] | |

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
| `parameters` | object | Per-instance overrides, if the object declares any |
| `ports` | Port[] | Resolved from the object definition, positioned by the transform |

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

**Undo/redo is a command stack over this model**, not a snapshot diff — see AD-8.

**Not in this model:** validation results. Those are computed, never stored in the
project. A stored verdict goes stale the moment a rule set or a placement changes, and a
stale verdict in a feasibility report is worse than no verdict.

## Implementation status

| Element | Sprint |
| --- | --- |
| Equipment Object, Placement, Port | 2 |
| Space, Space function vocabulary | 3 |
| Level, PlanImage, CoordinateMapping, ScaleCalibration | 4 |
| Project, save / load, schema migration | 4 |
