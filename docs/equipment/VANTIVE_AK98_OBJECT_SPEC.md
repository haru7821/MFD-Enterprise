# Vantive AK98 Object Specification


Version:

0.1


# Purpose

Define the first medical equipment object in MFD-E.


---

# Object Information


ID:

vantive_ak98


Category:

Dialysis Machine


Manufacturer:

Vantive


Model:

AK98


---

# Required Data


## Physical Dimension


Required:

Width

Depth

Height

Weight


Example:


Width:

900 mm


Depth:

750 mm



---

# Connection


Required:

Power

RO Water

Drain


Example:


Power:

AC


RO:

Required


Drain:

Required



---

# Service Clearance


Purpose:

Allow installation and maintenance.


Required:


Front clearance

Rear clearance

Left clearance

Right clearance



---

# Installation Metadata


Required:


Installation Manual Reference


Revision


Source


Last Updated Date



---

# Object Behavior


When placed on canvas:


System should:


1. Display equipment symbol

2. Display connection points

3. Display service area

4. Run clearance validation



---

# Future 3D Data


Reserved:


3D Model

BIM Object

IFC Reference


---

# Addendum — current record state

> Added Phase 4.5. The specification above is kept as supplied; this section records what
> the shipped catalogue actually holds, because the two now differ.

## The "Example" figures above are superseded

The 900 × 750 mm in *Physical Dimension* was marked **Example** and was never a
measurement. The catalogue carried it as its only footprint until Phase 4.5, when the
product owner supplied real figures and separated two things that had been one.

| | Value | Status |
| --- | --- | --- |
| **Manufacturer dimensions** | 585 × 620 × 1305 mm | Owner-supplied. **No document, revision or section yet.** |
| **Design footprint** | 800 × 800 mm | Owner-supplied. `basis` not yet written. |
| Weight | null | Not supplied |
| Service clearance, all four sides | null | **Not supplied — this is the remaining blocker** |
| Power · RO water · drain specification | null | Not supplied |

`packages/object-library/catalog/vantive_ak98.json`, record version **0.2.0**.

## Why the record is still `dataStatus: "draft"`

Because `verified` means *citable*, not *correct*. The schema requires a document, a
revision and a section before a record may claim it, and none has been supplied. These are
the right numbers with no reference behind them, which is precisely the state `draft`
exists to describe.

The practical consequence is unchanged: **no result computed from this record can reach
GREEN**, and every clearance finding still reads "threshold unknown", because the
clearances are still null.

`source.type` moved from `estimate` to `datasheet` — a better description of
owner-supplied manufacturer figures than "estimate" was, and still not a claim that a
manual has been read.

> **Open:** is `datasheet` right, or did these come from the installation manual? If the
> latter, the document number and revision would let this record become `verified`.

## Manufacturer dimensions vs design footprint

The distinction the owner introduced, and the reason this addendum exists rather than an
edit above:

- **Manufacturer dimensions are immutable reference data.** Nothing computes with them.
  They are quoted in the report and checked against the machine that arrives.
- **The design footprint is the planning area**, and it is what the canvas, placement
  engine, collision engine and auto-layout engine all measure.

800 × 800 is deliberately larger than 585 × 620: an installed station needs room for
hoses, a chassis wider at its base, and the working space an engineer treats as the
machine's. Full reasoning in
[../data-model/OBJECT_MODEL.md](../data-model/OBJECT_MODEL.md).

**The design footprint must never be written back over the manufacturer dimensions.** The
moment it is, the record can no longer be checked against the product.

## Still needed to complete this object

| # | Item |
| --- | --- |
| 1 | Manual document number, **revision**, and section for each figure |
| 2 | Front · rear · left · right service clearance |
| 3 | Weight |
| 4 | Power, RO water and drain specifications, and port positions on the chassis |
| 5 | Whether the manual labels left and right from the operator's side or the service engineer's — see [../rules/RULE_ENGINE_IMPLEMENTATION.md](../rules/RULE_ENGINE_IMPLEMENTATION.md) |
| 6 | One sentence for `designFootprint.basis` |
