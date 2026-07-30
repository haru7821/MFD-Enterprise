# Equipment Object Model

> The catalogue definition of a piece of medical equipment.
> Governed by [MFD-E_TS_EDITION_SPEC.md](../product/MFD-E_TS_EDITION_SPEC.md) and
> [VANTIVE_AK98_OBJECT_SPEC.md](../equipment/VANTIVE_AK98_OBJECT_SPEC.md).
> Version 0.3 — Sprint 1.5, revised in Phase 4.5. Implemented in Sprint 2.
>
> Version 0.2 separated manufacturer dimensions from the design footprint.
> Version 0.3 moved verification from the record to the **field group**.

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
├─ manufacturerDimensions   width · depth · height · weight    + verification  ← reference data
├─ designFootprint          width · depth · basis              (no verification) ← the engines use this
├─ connections
│  ├─ power                 required · port · specification    + verification
│  ├─ roWater               required · port · specification    + verification
│  └─ drain                 required · port · specification    + verification
├─ serviceClearance         front · rear · left · right        + verification
├─ environmental            specification                     + verification
└─ symbol                   how it draws on the canvas
```

Six groups carry a `verification` block. There is **no record-level status** — see
[Verification is per field group](#verification-is-per-field-group).

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

**Why the footprint carries no verification block.** Owner decision, Phase 4.5: the design
footprint is a **planning property with no manufacturer citation**. There is no document to
cite because the figure is not a measurement of anything — it is a decision about how much
floor a station is given. Asking it for a document would be asking the wrong question, and a
field that can never be satisfied is a field that gets filled with a sentence written to
satisfy it.

`basis` is the account of the decision, in prose, for the report. It is nullable, and null
is the honest value while the decision is recorded only in the owner's message. Nothing
gates on it: an earlier revision of this document required `basis` before any group could
claim `verified`, which treated an owner decision as unsourced data and would have held the
manufacturer's real, cited dimensions at `draft` over a missing sentence about a different
field.

What stops the footprint carrying an unaccounted-for area into GREEN is not a citation
requirement — it is that a finding derived from the footprint is a fact about rectangles,
and every finding that reads an *equipment* figure states which group it read.

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

### environmental

| Field | Type | Notes |
| --- | --- | --- |
| `specification` | object \| null | Free-form: ambient temperature range, humidity, heat output, ventilation |

Kept as one group because the manual states these together, and they are read together —
by the ventilation and heat-load questions of a later version rather than by any Phase 1
rule. Present now so the field-level verification the owner asked for has somewhere to
record that the environmental section of a manual has been read.

---

## Verification is per field group

Owner decision, Phase 4.5. **Verified data may coexist with draft data inside the same
equipment object, and a verified field is never downgraded because another field is
unknown.**

Six groups each carry their own `verification`:

| Group | JSON path |
| --- | --- |
| Manufacturer dimensions | `manufacturerDimensions.verification` |
| Service clearance | `serviceClearance.verification` |
| Electrical specification | `connections.power.verification` |
| RO water specification | `connections.roWater.verification` |
| Drain specification | `connections.drain.verification` |
| Environmental specification | `environmental.verification` |

```json
"verification": {
  "status": "verified",
  "source": {
    "document": "AK 98 Operator Manual",
    "revision": "Rev 04",
    "section": "15 Technical data",
    "type": "manufacturer_manual",
    "lastUpdated": "2026-07-30"
  }
}
```

`type` is one of `manufacturer_manual` · `datasheet` · `field_measurement` · `estimate`.

### Why per group and not per record

A manual arrives in pieces. The dimensions come off a datasheet months before anyone pins
down the service clearances; the electrical specification is often settled before either.

A record-level status forces the whole object down to its weakest field. The consequence
was not cosmetic: under the old model, an unsourced service clearance made *every* finding
on that machine provisional — including "these two machines overlap by 500 mm", which is a
fact about two rectangles and reads no manual figure at all. An engineer who had sourced
the dimensions saw the same amber warning as one who had sourced nothing, so the warning
stopped meaning anything.

The owner's example is now representable exactly as stated: dimensions verified, electrical
verified, environmental verified, service clearance draft.

### Loading rules, enforced by the catalogue loader

1. A group whose `status` is `verified` **must** name its `document`, `revision` and
   `section`. Missing any of them fails the load with an error naming the file, the group
   and the field.
2. A group whose `status` is `draft` loads normally.
3. `designFootprint` has **no verification block at all** and no citation is asked of it.
4. **A finding is provisional if any group it read is draft** — and only then. A provisional
   finding is capped at YELLOW and can never be GREEN (AD-6a).

### What each finding reads

Rule 4 is only meaningful if every evaluator declares its inputs, so each does:

| Evaluator | Groups it reads | Effect of a draft group elsewhere in the record |
| --- | --- | --- |
| Clearance, threshold from the equipment record | `serviceClearance` | None |
| Clearance, threshold from the rule | *none* | None |
| Equipment collision | *none* — design footprints only | None |
| Boundary collision | *none* — footprint and traced geometry | None |

Two consequences worth stating plainly. A machine whose service clearance is unknown still
produces a **non-provisional** collision finding, because nothing about the collision came
from the manual. And a clearance finding falling back to the rule's own threshold is not
provisional either — the number came from `standards/`, not from the record.

Plan calibration is a separate gate and is unaffected: an uncalibrated underlay turns GREEN
to YELLOW regardless of how well sourced the equipment is, because the millimetres
themselves are then in question.

### Where the AK98 stands today

All six groups are `draft`. Its manufacturer dimensions are real figures supplied by the
product owner — 585 × 620 × 1305 mm — but **no document, revision or section came with
them**, so `verified` would be a claim the record cannot support. These are the right
numbers with no citation yet, which is exactly the distinction the field is for.

Each group flips on its own as its reference arrives. Filling in the dimensions' citation
makes collision and dimension reporting verified while every clearance finding stays
provisional, and that is the intended behaviour, not a transitional state to be tidied up.

One thing this change does **not** do today: it does not turn any finding on screen from
YELLOW to GREEN. Every rule in `standards/rules/dialysis/` is itself `status: "draft"`, and
a draft rule makes its own finding provisional whatever the equipment says. So the visible
effect arrives with the rule sources, and what changed now is which unknowns can hold a
result back — an unsourced clearance no longer holds back a collision.

---

## Example record

The shipped AK98 record, abbreviated: the three connections and the environmental group
each carry a `verification` block of the same shape as the two shown.

```json
{
  "id": "vantive_ak98",
  "category": "dialysis_machine",
  "manufacturer": "Vantive",
  "model": "AK98",
  "version": "0.3.0",
  "manufacturerDimensions": {
    "width": 585, "depth": 620, "height": 1305, "weight": null,
    "verification": {
      "status": "draft",
      "source": {
        "document": null, "revision": null, "section": null,
        "type": "datasheet", "lastUpdated": "2026-07-30"
      }
    }
  },
  "designFootprint": { "width": 800, "depth": 800, "basis": null },
  "serviceClearance": {
    "front": null, "rear": null, "left": null, "right": null,
    "verification": {
      "status": "draft",
      "source": {
        "document": null, "revision": null, "section": null,
        "type": "estimate", "lastUpdated": "2026-07-30"
      }
    }
  },
  "symbol": { "origin": "front-left", "outline": "rectangle", "frontEdge": "south" }
}
```

Note the two `type` values. The dimensions are `datasheet` — real figures, uncited. The
clearances are `estimate`, and every side is null, so nothing is being estimated yet
either. Nulls are honest: a record that filled `serviceClearance.front` with 1200 because a
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
| Field-level verification (replacing record-level `dataStatus`) | 4.5 |
| Clearance evaluation against these values | 3 |
| Equipment schedule in the report, verified and draft sections | 5 |
