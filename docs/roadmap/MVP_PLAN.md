# MVP Plan — MFD-E TS Edition Version 1

> Governed by [MFD-E_TS_EDITION_SPEC.md](../product/MFD-E_TS_EDITION_SPEC.md).
> Sprint 1 tasks are those defined in [CLAUDE_SPRINT1_PROMPT.md](CLAUDE_SPRINT1_PROMPT.md).

## Definition of done for the MVP

A Vantive TS engineer can:

1. Import a hospital's floor plan (PDF, PNG or JPG) and set its scale.
2. Define the dialysis room on it.
3. Place AK98 units at true dimensions from an equipment catalogue.
4. See which installation requirements pass, need review, or fail — **and read the manual
   section each result comes from**.
5. Export a PDF installation review report.

Point 4 is the product. Everything else is delivery mechanism.

---

## Sprint 1 — Foundation

Tasks as written in `CLAUDE_SPRINT1_PROMPT.md`.

| Task | Deliverable | Status |
| --- | --- | --- |
| 1 | Project structure: `apps/web`, `packages/object-library`, `packages/rule-engine`, `packages/report-engine` | ✅ shipped in v0.1 Alpha — the three packages still need real manifests |
| 2 | Equipment data system: JSON equipment database, first object Vantive AK98 | ☐ |
| 3 | Canvas foundation: canvas, zoom, pan, grid | ✅ shipped in v0.1 Alpha |
| 4 | Object renderer: load equipment JSON, display equipment, show dimensions | ☐ |
| 5 | Rule engine foundation: rule loading system only, no fixed values | ☐ |

**Acceptance criteria for the remaining tasks**

- A malformed equipment JSON file is rejected with an error naming the file and the field.
- An AK98 placed on the canvas measures its catalogue width and depth at any zoom level.
- Connection points (power, RO water, drain) and the service clearance area are visible.
- Changing a value in the equipment JSON changes what is drawn, with no code change.
- A rule record missing its source information is rejected at load time.
- Data marked `draft` can never produce a GREEN result.

**Out of scope for Sprint 1:** floor plan import, clearance evaluation logic, collision
detection, report generation, AI, BIM, 3D.

## Sprint 2 — Floor Plan Import and Scale Setting

Spec section 5.1 and the "Scale Setting" item of 5.2.

Raster underlay import for PDF, PNG and JPG; two-point scale calibration where the user
picks two points on the imported plan and enters the real distance between them; the plan
as a locked background layer beneath the design.

**Done when:** a hospital PDF is imported, calibrated, and a 900 mm machine placed on it
measures 900 mm against the drawing's own dimension lines.

Without this step, every clearance check on an imported plan is measuring screen distance
rather than real distance — which is why calibration is a Sprint 2 requirement and not a
later refinement.

Also lands here: the document model (`Project → Floor Plan → Room → Placement`) with a
schema version from v1, and undo/redo.

## Sprint 3 — Engineering Validation

Spec section 5.4. Clearance evaluation, equipment collision, wall collision, connection
availability, maintenance access path. Results as GREEN / YELLOW / RED per
[DIALYSIS_RULE_ENGINE_v0.1.md](../rules/DIALYSIS_RULE_ENGINE_v0.1.md), each carrying the
rule that produced it and that rule's source.

**Done when:** moving an AK98 too close to a wall raises a RED result naming the manual
section it violates, and editing the rule JSON changes the outcome with no code change.

**Blocked by:** the real clearance figures and their manual revision.

## Sprint 4 — Report Generator

Spec section 5.5. A PDF installation review report containing project information, layout
image, equipment list, engineering check results and an installation checklist.

Vector output, not a canvas screenshot — the geometry already lives outside the renderer
to make this possible.

**Done when:** the report is something a TS engineer would send to a hospital.

---

## Non-functional targets (spec section 6)

| Requirement | How it is met |
| --- | --- |
| Support 50 equipment objects minimum | Measured at the end of Sprint 1, when real objects first exist |
| All engineering values come from the database | Equipment catalogue and rule sets are JSON files, versioned in git and loaded at runtime |
| Every rule requires source information | Enforced at load time — a rule marked verified without a document reference, revision and section fails to load |

## What would make this plan wrong

If imported floor plans turn out to be mostly vector PDFs whose geometry the engineer
expects MFD-E to read — walls detected automatically rather than traced — Sprint 2 grows
substantially. The plan above assumes a raster underlay the engineer works on top of.
