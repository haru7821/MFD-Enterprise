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
| **Design footprint** | 800 × 800 mm | Owner decision. Carries no citation, by design. |
| Weight | null | Not supplied |
| Service clearance, all four sides | null | **Not supplied — this is the remaining blocker** |
| Power · RO water · drain specification | null | Not supplied |
| Environmental specification | null | Not supplied |

`packages/object-library/catalog/vantive_ak98.json`, record version **0.3.0**.

## Verification is now per field group

Owner decision, Phase 4.5: verification moved from the record to the field group, so
verified and draft data coexist inside one object and **a verified field is never
downgraded because another field is unknown**. Six groups each carry a status and a source:
manufacturer dimensions, service clearance, the three connection specifications, and the
environmental specification.

On this record all six are `draft`, and for one reason each: no group cites a document.
`verified` means *citable*, not *correct* — the schema requires a document, a revision and a
section before a group may claim it. These are the right numbers with no reference behind
them, which is precisely what `draft` describes.

The dimensions' `source.type` is `datasheet` — a better description of owner-supplied
manufacturer figures than `estimate`, and still not a claim that a manual has been read.
The other five are `estimate`, and their values are null, so nothing is being estimated
either.

**What changes when the dimensions are cited.** That group alone flips to `verified`.
Equipment collision and boundary findings on this machine read only the design footprint,
so they were never provisional to begin with; every clearance finding stays provisional
until the clearance group is cited, and continues to read "threshold unknown" while the four
sides are null. Nothing else in the record moves, and no code changes.

> **Open:** is `datasheet` right for the dimensions, or did they come from the installation
> manual? If the latter, the document number and revision would let that group become
> `verified` on its own — no other field need be resolved first.

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

Per-group verification means these can arrive in any order and each is useful on its own.
None of them is blocked on the others.

| # | Item | Which group it verifies |
| --- | --- | --- |
| 1 | Manual document number, **revision**, and section for the dimensions | Manufacturer dimensions |
| 2 | Front · rear · left · right service clearance, with its citation | Service clearance |
| 3 | Weight | Manufacturer dimensions (same citation) |
| 4 | Power, RO water and drain specifications, port positions, and their citations | The three connection groups, separately |
| 5 | Ambient temperature, humidity and heat output, with its citation | Environmental specification |
| 6 | Whether the manual labels left and right from the operator's side or the service engineer's — see [../rules/RULE_ENGINE_IMPLEMENTATION.md](../rules/RULE_ENGINE_IMPLEMENTATION.md) | Affects how the clearance figures are read, not their status |
| 7 | One sentence for `designFootprint.basis` | None — the footprint is an owner decision and is not verified |
