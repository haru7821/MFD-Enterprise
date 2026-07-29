# Development Roadmap

> Governed by [MFD-E_TS_EDITION_SPEC.md](../product/MFD-E_TS_EDITION_SPEC.md).
> Version numbering follows section 7 of that specification.
> Estimates assume **1–2 full-time developers**; they are relative sizing, not commitments.

## Ordering principle

> canvas → equipment → rules → floor plan → validation → report → routing → AI → twin

Validation comes before AI, and equipment before validation. A tool that judges a layout
before it can describe one has nothing to judge; an AI that proposes layouts before a
validator exists produces confident, unverifiable output. In a workflow whose product is
an installation feasibility report, that is the worst possible failure.

---

## Version 1 — MVP: Installation Feasibility Review

Delivers sections 5.1–5.5 of the TS Edition specification. Sprint detail in
[MVP_PLAN.md](MVP_PLAN.md).

| Sprint | Delivers | Spec section |
| --- | --- | --- |
| **1** | Project structure · canvas · equipment data system · object renderer · rule engine foundation | 5.2, 5.3 |
| **2** | Floor plan import (PDF/PNG/JPG) and scale setting | 5.1 |
| **3** | Engineering validation — clearance, collision, connection, maintenance access | 5.4 |
| **4** | Report generator — installation review PDF | 5.5 |

**Done when:** a Vantive TS engineer opens a hospital's PDF floor plan, sets its scale,
places AK98 units, sees which installation requirements pass or fail **with the manual
section each requirement comes from**, and exports a report they would send to the
customer.

**Current position:** Sprint 1 is in progress — Tasks 1 and 3 shipped as v0.1 Alpha,
Tasks 2, 4 and 5 remain.

**Blocked by:** real AK98 dimensions and clearance figures with their manual revision.
The engine can be built without them; it cannot be seeded with anything true.

## Version 2 — Routing and Automatic Layout

RO water routing, electrical routing, automatic layout generation. `routing-engine` and
`layout-engine` begin here.

Automatic layout is a constraint solver operating under the Version 1 rule engine, not a
generative model. The rules it satisfies must already be real.

## Version 3 — AI Design Assistant and BIM

The AI assistant interprets intent, explains why a layout was chosen, and drafts
documentation. BIM object support and IFC references (reserved in the AK98 object spec)
land here.

**Blocked by:** whether project data may leave the hospital network — see
[OPEN_QUESTIONS](../OPEN_QUESTIONS.md) B-1. If it may not, the AI service must run
self-hosted, which changes its architecture rather than its schedule.

## Version 4 — Digital Twin

Three.js visualisation, as-built model sync, equipment lifecycle and telemetry.

---

## Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Real AK98 data never arrives | Fatal — the product becomes invented numbers wearing a citation field | Equipment and rule records carry `dataStatus`. Draft data can never produce a GREEN result, so an unverified figure cannot silently pass an installation. |
| Rule schema too narrow for the second machine | Rewrite in Version 2 | Test the schema against a second manufacturer's manual *on paper* during Sprint 3, before freezing it. |
| PDF import complexity underestimated | Sprint 2 overruns | Scope Sprint 2 to raster underlay plus two-point scale calibration. Vector PDF parsing and DXF are explicitly Version 2. |
| Konva performance at 50 objects | Spec section 6 unmet | Measure at the end of Sprint 1, when real objects first exist. |
| Scope creep toward general CAD | Never ships | The specification is explicit: this is not a replacement for CAD. Every drawing feature must be justified by a TS engineer's feasibility check. |
| Vision document drives current work | Wrong priorities | CLAUDE.md now states that the TS Edition specification governs Phase 1. |
