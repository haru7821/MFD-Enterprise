# Equipment Object Model

> The catalogue definition of a piece of medical equipment.
> Governed by [MFD-E_TS_EDITION_SPEC.md](../product/MFD-E_TS_EDITION_SPEC.md) and
> [VANTIVE_AK98_OBJECT_SPEC.md](../equipment/VANTIVE_AK98_OBJECT_SPEC.md).
> Version 0.1 — Sprint 1.5. Implemented in Sprint 2.

## Object versus Placement

| | Equipment Object | Placement |
| --- | --- | --- |
| What it is | The AK98 **as a model** | **One machine** on one drawing |
| Where it lives | `packages/object-library/catalog/*.json` | Inside a Project (see [PROJECT_MODEL.md](PROJECT_MODEL.md)) |
| How many | One per model | Twenty per room |
| Who edits it | Whoever holds the manufacturer manual | The TS engineer |
| Carries dimensions | **Yes** | No — it references them |

Twenty AK98 units on a drawing share one set of dimensions. When the installation manual
is revised, one file changes and all twenty placements follow. If each placement carried
its own copy, they would drift apart, and drifted equipment data looks exactly like
correct equipment data until someone measures a room that was already built.

---

## Record structure

```
EquipmentObject
├─ identity          id · category · manufacturer · model · version
├─ dimension         width · depth · height · weight
├─ connections       power · roWater · drain (each with a port position)
├─ serviceClearance  front · rear · left · right
├─ symbol            how it draws on the canvas
├─ provenance        manual reference · revision · source · lastUpdated
└─ dataStatus        draft | verified
```

### identity

| Field | Type | Example |
| --- | --- | --- |
| `id` | string | `vantive_ak98` |
| `category` | EquipmentCategory | `dialysis_machine` |
| `manufacturer` | string | `Vantive` |
| `model` | string | `AK98` |
| `version` | string | Catalogue record version, bumped whenever a value changes |

`version` is stamped into every Placement, so a report can state exactly which record
produced its numbers.

**EquipmentCategory** (controlled vocabulary): `dialysis_machine` · `treatment_chair` ·
`treatment_bed` · `ro_unit` · `water_loop_component` · `sink` · `storage` · `other`

### dimension

| Field | Unit | Notes |
| --- | --- | --- |
| `width` | mm | Along the object's local X |
| `depth` | mm | Along local Y — the footprint depth |
| `height` | mm | Not drawn in 2D; carried for future use and for the equipment schedule |
| `weight` | kg | Feeds floor loading questions in a later version |

The footprint is `width × depth`, drawn from the object's local origin at its front-left
corner unless `symbol.origin` says otherwise.

### connections

Each connection is present or absent, and when present carries where it sits on the object.

| Field | Type | Notes |
| --- | --- | --- |
| `required` | boolean | Does this machine need this service at all |
| `port` | Vec2 \| null | Position in object-local millimetres |
| `specification` | object | Free-form per kind — voltage/phase/rating, supply pressure/flow, drain diameter |

Kinds for the dialysis MVP: `power`, `roWater`, `drain`.

The specification object is deliberately loose in v0.1: we do not yet have the real manual
data, and inventing a rigid electrical schema before seeing the actual figures would mean
rewriting it. It tightens in Sprint 3 once real values exist.

### serviceClearance

| Field | Unit | Purpose |
| --- | --- | --- |
| `front` | mm | Operating and patient access |
| `rear` | mm | Maintenance access |
| `left` | mm | Side access |
| `right` | mm | Side access |

Clearances are **object data, not rules**. The rule engine reads them and decides whether
a layout satisfies them; it does not hold the numbers. That is the difference between
"the AK98 needs 1200 mm in front" (an equipment fact) and "front clearance must be
satisfied and a violation is RED" (a rule).

Note that manufacturer service clearance often exceeds anything a building code requires,
which is exactly why the manual is the authority for this product.

### symbol

How the object draws. Kept as data so a new machine needs no code.

| Field | Type | Notes |
| --- | --- | --- |
| `origin` | `front-left` \| `centre` | Where local (0,0) sits on the footprint |
| `outline` | `rectangle` \| Vec2[] | Rectangle from the footprint, or an explicit polygon |
| `frontEdge` | `north` \| `south` \| `east` \| `west` | Which side the front clearance applies to at zero rotation |

### provenance

| Field | Type | Notes |
| --- | --- | --- |
| `sourceDocument` | string \| null | Manual title or document number |
| `revision` | string \| null | Manual revision |
| `section` | string \| null | Where in the manual the figures come from |
| `source` | `manufacturer_manual` \| `datasheet` \| `field_measurement` \| `estimate` | |
| `lastUpdated` | date | |

### dataStatus

`draft` | `verified`

**Loading rules, enforced by the catalogue loader:**

1. A record marked `verified` **must** carry `sourceDocument`, `revision` and `section`.
   Missing any of them fails the load with an error naming the file and field.
2. A record marked `draft` loads normally and is marked in the UI.
3. **Any validation result computed from `draft` data is capped at YELLOW.** It can never
   be GREEN.

Rule 3 is the important one. The project currently holds example figures — 900 × 750 mm,
1200 mm clearance — that came from a specification as illustrations, not measurements.
The failure this product exists to prevent is a plausible number quietly becoming an
authoritative one, and a TS engineer signing a feasibility report built on it. That has to
be stopped by the engine rather than by whoever happens to remember.

When the real manual arrives, `dataStatus` flips to `verified`, provenance is filled in,
and GREEN becomes reachable. Nothing else changes.

---

## Example record

Illustrative only. **Values are placeholders from the object specification, not measured
data** — hence `dataStatus: "draft"` and null provenance.

```json
{
  "id": "vantive_ak98",
  "category": "dialysis_machine",
  "manufacturer": "Vantive",
  "model": "AK98",
  "version": "0.1.0",
  "dataStatus": "draft",
  "dimension": { "width": 900, "depth": 750, "height": null, "weight": null },
  "connections": {
    "power":   { "required": true, "port": null, "specification": {} },
    "roWater": { "required": true, "port": null, "specification": {} },
    "drain":   { "required": true, "port": null, "specification": {} }
  },
  "serviceClearance": { "front": null, "rear": null, "left": null, "right": null },
  "symbol": { "origin": "front-left", "outline": "rectangle", "frontEdge": "south" },
  "provenance": {
    "sourceDocument": null,
    "revision": null,
    "section": null,
    "source": "estimate",
    "lastUpdated": "2026-07-29"
  }
}
```

Nulls are honest. A record that filled `serviceClearance.front` with 1200 because a
document used it as an example would be indistinguishable from one holding a real figure.

## Reserved for later versions

Per the object specification: `model3d`, `bimObject`, `ifcReference`. Declared here so
their absence is a decision rather than an omission; not implemented before Version 3.

## Implementation status

| Element | Sprint |
| --- | --- |
| Schema, catalogue loader, validation, AK98 record | 2 |
| Symbol rendering, dimensions, ports on canvas | 2 |
| Clearance evaluation against these values | 3 |
| Equipment schedule in the report | 5 |
