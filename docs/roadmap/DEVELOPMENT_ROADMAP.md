# Development Roadmap

> Long view. For the executable plan see [MVP_PLAN.md](MVP_PLAN.md).
> Versions follow section 7 of
> [MFD-E_TS_EDITION_SPEC.md](../product/MFD-E_TS_EDITION_SPEC.md).

## Ordering principle

> canvas → equipment → rules → floor plan → report → AI → routing → twin

Validation comes before AI, and equipment before validation. A tool that judges a layout
before it can describe one has nothing to judge; an AI that proposes layouts before a
validator exists produces confident, unverifiable output. For a product whose deliverable
is an installation feasibility report, that is the worst available failure.

---

## Sprint sequence

| Sprint | Name | Delivers |
| --- | --- | --- |
| 1 | Foundation | Monorepo, geometry core, canvas, zoom/pan/grid — ✅ v0.1 Alpha |
| 1.5 | Architecture stabilisation | Documentation structure, data model, CI — ✅ |
| 2 | Equipment Object System | Equipment catalogue, object renderer, placement |
| 3 | Rule Engine | Installation requirement validation, GREEN/YELLOW/RED |
| 4 | PDF Workflow | Floor plan import, scale calibration, save/load |
| 5 | Report Generation | Installation review PDF |
| 6 | AI Assistant | Intent interpretation and explanation |

Sprints 1–5 deliver **Version 1**, the MVP defined by specification sections 5.1–5.5.

## Version map

| Version | Content | Sprints |
| --- | --- | --- |
| **1** | Installation feasibility review: import → place → validate → report | 1–5 |
| **2** | RO routing, electrical routing, automatic layout | not yet scheduled |
| **3** | AI design assistant, BIM | 6 (assistant); BIM unscheduled |
| **4** | Digital twin | unscheduled |

**Sequencing note.** The sprint list reaches the Version 3 AI assistant at Sprint 6, ahead
of the Version 2 routing work. That is the product owner's ordering, and it is defensible:
the assistant explains results the Sprint 3 validator already produces, whereas routing
needs a service-network model that does not exist yet. Version 2's routing and automatic
layout are not cancelled — they are unscheduled, and will slot in once the routing model
is specified.

**Version 1 done when:** a Vantive TS engineer opens a hospital's PDF floor plan, sets its
scale, places AK98 units, sees which installation requirements pass or fail with the manual
section each result comes from, and exports a report they would send to the customer.

**Version 1 blocked by:** real AK98 dimensions and clearance figures with their manual
revision. The engine can be built without them; it cannot be seeded with anything true.
See [OPEN_QUESTIONS](../OPEN_QUESTIONS.md).

---

## Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Real AK98 data never arrives | Fatal — the product becomes invented numbers wearing a citation field | Every field group carries its own verification status. A finding that reads a draft group can never produce GREEN, so an unverified figure cannot silently pass an installation — and a group that *is* cited counts, so partial data is worth supplying. |
| Rule schema too narrow for the second machine | Rewrite during Version 2 | Test the schema against a second manufacturer's manual *on paper* during Sprint 3, before freezing it. |
| PDF import complexity underestimated | Sprint 4 overruns | Scope to raster underlay plus two-point calibration. Vector extraction and DXF stay in the specification's Future list. |
| Konva performance at 50 objects | Specification section 6 unmet | Measure at the end of Sprint 2, when real objects first exist. |
| Scope creep toward general CAD | Never ships | The specification is explicit: this does not replace CAD. Every drawing feature must be justified by a TS engineer's feasibility check. |
| AI expectations outrun the validator | Untrustworthy output | AD-10: the validator decides, the assistant explains. Sprint 6 follows Sprint 3 for this reason. |
| Vision document drives current work | Wrong priorities | CLAUDE.md states that the TS Edition specification governs Phase 1. |
