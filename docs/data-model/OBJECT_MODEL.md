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
| Carries dimensions and footprint | **Yes** | No — it references them |

Twenty AK98 units on a drawing share one set of dimensions. When the installation manual
is revised, one file changes and all twenty placements follow. If each placement carried
its own copy, they would drift apart, and drifted equipment data looks exactly like
correct equipment data until someone measures a room that was already built.

---

## Record structure

```
EquipmentObject
├─ identity                 id · category · manufacturer · model · version
├─ manufacturerDimensions   width · depth · height · weight        ← reference data
├─ designFootprint          width · depth · basis                  ← what the engines use
├─ connections              power · roWater · drain (each with a port position)
├─ serviceClearance         front · rear · left · right
├─ symbol                   how it draws on the canvas
├─ provenance               manual reference · revision · source · lastUpdated
└─ dataStatus               draft | verified
```

### identity

| Field | Type | Example |
| --- | --- | --- |
| `id` | string | `vantive_ak98` |
| `category` | EquipmentCategory | `dialysis_machine` |
| `manufacturer` | string \| null | `Vantive`; **null** for a generic planning object |
| `model` | string | `AK98` |
| `version` | string | Catalogue record version, bumped whenever a value changes |

`version` is stamped into every Placement, so a report can state exactly which record
produced its numbers.

**EquipmentCategory** (controlled vocabulary): `dialysis_machine` · `treatment_chair` ·
`treatment_bed` · `ro_unit` · `water_loop_component` · `sink` · `storage` · `other`

### Manufacturer dimensions and design footprint

These are **two different things**, and separating them is the single most important
decision in this document.

| | `manufacturerDimensions` | `designFootprint` |
| --- | --- | --- |
| What it is | What the product measures | The area a plan reserves for it |
| Authority | The installation manual (AD-6) | The reviewing organisation's planning standard |
| Who reads it | The report, and an engineer checking a delivery | **The canvas, placement, collision and auto-layout engines** |
| May be unknown | Yes — every field nullable | **No.** Width and depth are required |
| Mutable | **Never.** Reference data | A planning decision, revisable |

#### manufacturerDimensions

| Field | Unit | Notes |
| --- | --- | --- |
| `width` | mm \| null | Along the object's local X |
| `depth` | mm \| null | Along local Y |
| `height` | mm \| null | Not drawn in 2D; needed for doorways, lifts and the equipment schedule |
| `weight` | kg \| null | Feeds floor loading questions in a later version |

**Nothing in the application computes with these.** They are quoted in the report, checked
against what arrives on site, and used to confirm a design footprint is large enough. They
are never adjusted to make a layout work.

Width and depth are nullable because a generic planning object — a bed, a chair — has a
footprint and no product behind it. Forcing a number would mean inventing one.

#### designFootprint

| Field | Unit | Notes |
| --- | --- | --- |
| `width` | mm | Required, positive |
| `depth` | mm | Required, positive |
| `basis` | string \| null | Why this area, in a sentence |

The footprint is `width × depth`, drawn from the object's local origin at its front-left
corner unless `symbol.origin` says otherwise.

**Why it is larger than the machine.** A 585 × 620 mm machine is not planned at 585 × 620.
An installed station needs room for hoses, a chassis wider at the base than the top, a
footprint that stays valid when the machine is swapped for the next model, and the working
space an engineer treats as belonging to the machine rather than to the corridor. So the
planning area is a decision, made once, and it is bigger. The AK98's is 800 × 800.

**Why conflating them was dangerous.** Until this split the catalogue had a single
`dimensions`, and it was doing both jobs. The failure mode is specific: the moment a
planner rounds the footprint up to make a layout work, the manufacturer's measurement is
gone, and the record can no longer be checked against the machine that arrives.

**Why `basis` exists.** A design footprint has no manual to cite. But an unsourced number
is exactly what the rest of this product refuses, and a report printing "800 × 800" with no
account of where it came from invites a question it cannot answer. So `basis` is that
account — and a record **cannot claim `verified` while it is null**, which closes the hole
the split would otherwise open: sourced manufacturer figures carrying an unaccounted-for
planning area into GREEN (AD-6a).

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
2. A record marked `verified` **must** also carry `designFootprint.basis`. The footprint is
   what every geometric check measures, so a sourced manufacturer figure must not be able
   to carry an unaccounted-for planning area into GREEN.
3. A record marked `draft` loads normally and is marked in the UI.
4. **Any validation result computed from `draft` data is capped at YELLOW.** It can never
   be GREEN.

Rule 4 is the important one. The AK98's manufacturer dimensions are now real figures
supplied by the product owner — 585 × 620 × 1305 mm — but **no document, revision or
section has been supplied with them**, and its service clearances are still null. So the
record stays `draft`: these are the right numbers with no citation yet, and that is exactly
the distinction `dataStatus` exists to hold. The failure this product exists to prevent is
a plausible number quietly becoming an authoritative one, and a TS engineer signing a
feasibility report built on it.

When the manual arrives, provenance and clearances are filled in, `basis` is written,
`dataStatus` flips to `verified`, and GREEN becomes reachable. No code changes.

---

## Example record

The shipped AK98 record. Manufacturer dimensions and design footprint are the owner's
figures; **provenance and clearances are still null**, which is why `dataStatus` is
`draft`.

```json
{
  "id": "vantive_ak98",
  "category": "dialysis_machine",
  "manufacturer": "Vantive",
  "model": "AK98",
  "version": "0.2.0",
  "dataStatus": "draft",
  "manufacturerDimensions": { "width": 585, "depth": 620, "height": 1305, "weight": null },
  "designFootprint": { "width": 800, "depth": 800, "basis": null },
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
| Symbol rendering, footprint, ports on canvas | 2 |
| Manufacturer / design footprint split | 4.5 |
| Clearance evaluation against these values | 3 |
| Equipment schedule in the report | 5 |
