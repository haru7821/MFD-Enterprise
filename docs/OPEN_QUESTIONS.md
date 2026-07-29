# Open Questions / Missing Information

> Everything the architecture depends on that CLAUDE.md does not yet specify.
> Ordered by how much damage a wrong assumption causes.

## A. Blocking — cannot start Phase 1 without an answer

### A-1. Which code basis governs? (highest impact)

CLAUDE.md says standards live in `/standards/rules` but never names a standard.
Candidates: 의료법 시행규칙 (Korea), 인공신장실 운영 관련 기준/학회 권고,
AAMI/ANSI (water treatment for dialysis), FGI Guidelines (US), a specific hospital's
internal standard.

Without the actual source documents, any `equipment_clearance.json` we write is invented
numbers wearing a citation field — which is exactly the failure mode the platform exists
to prevent.

**Needed:** the governing document(s), edition/year, and jurisdiction.

### A-2. Does the user import an existing floor plan, or draw from scratch?

The MVP list says "2D Canvas" but not what is on it. These are different products:

- **(a) Underlay import** — user loads DWG/DXF/PDF architectural plan, traces or
  auto-detects spaces, places equipment on it. Requires a DWG/DXF parser or PDF raster
  underlay. Large scope.
- **(b) Draw from scratch** — user draws walls and spaces in MFD-E. Requires a wall/space
  drawing tool. Medium scope.
- **(c) Bay-level only** — no building; user configures a dialysis unit layout on a blank
  rectangular boundary they type dimensions for. Small scope, ships fastest.

**Recommendation:** (c) for Phase 1, (b) in Phase 2, (a) in Phase 3.
**This single answer moves the MVP date by weeks.**

### A-3. Real clearance values with citations, for dialysis specifically

Required before the rule engine can be seeded: station/bay footprint, spacing between
stations, aisle and circulation width, stretcher and wheelchair access, distance to
handwash stations, isolation station count or ratio, water treatment room requirements
and its distance to the treatment floor, staff station sightlines.

**Needed:** a table of value + unit + source clause. If you have a reference project or a
past design that passed inspection, that is the fastest input.

### A-4. Equipment catalogue source

Real dialysis machine models and dimensions (e.g. Fresenius, Nikkiso, JMS, Baxter),
treatment chairs/beds, RO units, and their **manufacturer-specified service clearances**
(which often exceed code clearance).

**Needed:** which machines to support first, and whether we may use manufacturer spec
sheets as the data source.

### A-5. Who is the primary user?

Hospital facility engineer / architect / medical equipment vendor / design consultant /
hospital administrator. This determines vocabulary, default views, and what "done" looks
like for an output document. A vendor wants an equipment schedule; an architect wants a
drawing that drops into their CAD set.

### A-6. What is the accepted deliverable format?

PDF is on the MVP list. But if the output must enter an architect's drawing set, **DXF
export is the real requirement** and PDF is a preview. Confirm whether PDF alone is
sufficient for Phase 1.

### A-7. Deployment and tenancy

Cloud SaaS (multi-tenant), on-prem single hospital, or desktop-only offline? This decides
the `apps/api` auth model, whether Electron is Phase 1 or Phase 3, and where data lives.

### A-8. UI language

CLAUDE.md is English; the existing repository docs are Korean. Decide: Korean-only,
English-only, or i18n from day 1. Reports and rule citation text are the expensive part —
retrofitting i18n into generated documents is painful.

## B. Needed before Phase 2 (AI)

### B-1. LLM provider, model, and data residency

Can project data (floor plans, hospital names, equipment lists) leave the hospital
network? If not, the AI service must run a self-hosted model, and the architecture in
AD-10 changes. This is a compliance question, not a technical preference.

### B-2. What "AI designs the layout" means concretely

Full generative layout from a prompt, or constraint-solver optimisation with an LLM
front-end? Recommendation in AD-10 is the latter. Confirm the expectation, because it
changes what Phase 2 delivers.

### B-3. Optimisation objective

When multiple layouts satisfy all rules, what makes one better? Station count
maximisation, staff walking distance, sightlines, plumbing run length, daylight,
construction cost. Needs a ranked objective list to build an optimiser at all.

## C. Needed before Phase 4 (Digital Twin)

- Data sources: BMS, equipment telemetry, RTLS, maintenance system. Which protocols
  (BACnet, Modbus, MQTT, HL7/FHIR for the clinical side)?
- Is the twin as-built documentation, live monitoring, or simulation? Three different systems.

## D. Product and liability posture

### D-1. What does "validated" mean legally?

If MFD-E reports a design as compliant and an inspection disagrees, what is the platform's
stated position? Recommendation: outputs are engineering aids requiring a qualified
professional's review, stated in the report itself, with every finding traceable to a
clause. Needs an explicit decision before any report leaves the building.

### D-2. Team size and timeline expectation

The roadmap currently assumes **1–2 full-time developers**. Confirm, so estimates mean
something.

## E. Answered by assumption (proceeding unless corrected)

These are not blocking; recorded so the assumption is visible:

| # | Assumption |
| --- | --- |
| E-1 | Metric units, millimetres, throughout. |
| E-2 | Single-user editing per project in Phase 1; no real-time collaboration. |
| E-3 | Web-first; Electron deferred (see AD-4 flagged decisions). |
| E-4 | Documentation is written in English to match CLAUDE.md, pending A-8. |
| E-5 | Rule sets are versioned in git under `standards/`, mirrored into PostgreSQL. |
