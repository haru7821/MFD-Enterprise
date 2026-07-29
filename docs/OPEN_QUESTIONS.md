# Open Questions

> What the project still needs from the product owner, and what has been settled.
> Restructured in Sprint 1.5 — resolved items moved to section D so the open ones are
> visible.

---

## A. Blocking — Sprint 3 cannot be seeded without these

### A-1. The AK98 installation data package ← **the one that matters**

This is the single blocker for the product's purpose. Everything else on this page can
wait.

The rule engine can be *built* without it. It cannot be *seeded* with anything true, and a
seeded-with-guesses rule engine is worse than none: it produces a confident feasibility
report a TS engineer might sign.

**Needed, from the manufacturer installation manual:**

| Item | Why |
| --- | --- |
| Manual document number and **revision** | A clearance is true "for the AK98 at revision X". Without the revision we cannot say what a report was based on, or what a future revision invalidates. |
| Section reference for each figure | Specification section 6 requires source information per rule. "Manufacturer Manual" alone does not meet that bar. |
| Width · Depth · Height · Weight | The 900 × 750 mm currently in the object specification is marked "Example" — a placeholder, not a measurement. |
| Front · Rear · Left · Right service clearance | The 1200 mm in the rule specification is likewise illustrative. |
| Power specification | Voltage, phase, rating |
| RO water specification | Supply pressure, flow, connection type |
| Drain specification | Diameter, connection type, height |

**Until this arrives:** the AK98 catalogue record ships as `dataStatus: "draft"`, and the
engine caps any result derived from it at YELLOW. GREEN becomes reachable the moment the
real figures land — flipping one field, no code change. See
[OBJECT_MODEL.md](data-model/OBJECT_MODEL.md).

---

## B. Needed before their sprint, not before now

### B-1. Deployment and data location — before any backend work

Cloud SaaS, on-prem at each hospital, or a purely local desktop tool?

Less urgent than it was: the MVP feature list (specification 5.1–5.5) needs no server, so
Version 1 can ship without `apps/api` at all. The question returns when project sharing or
a central equipment catalogue becomes a requirement.

### B-2. UI language — cheap now, expensive later

Korean only, English only, or both from the start? The expensive part is not the interface
but the **generated report** and the rule citation text. Retrofitting a second language
into a document generator is painful; designing for it costs almost nothing today.

Currently assumed: English documentation, interface language undecided.

### B-3. Liability posture — before the first report leaves the building

If MFD-E reports an installation as feasible and the site disagrees, what is the product's
stated position?

**Recommendation:** the report states that it is an engineering aid requiring a qualified
engineer's review, and every finding is traceable to a manual section. That traceability is
already designed in; the wording needs an owner decision.

### B-4. AI assistant scope and data residency — before Sprint 6

- May project data (floor plans, hospital names, equipment lists) leave the hospital
  network? If not, the assistant must run self-hosted, which changes its architecture.
- Does "AI assistant" mean generating layouts, or interpreting and explaining the
  validator's results? AD-10 recommends the latter.

### B-5. Optimisation objective — before automatic layout

When several layouts satisfy every rule, what makes one better? Station count, staff
walking distance, service run length, construction cost? An optimiser cannot be built
without a ranked objective. Automatic layout is currently unscheduled.

### B-6. Digital twin scope — Version 4

Data sources (BMS, equipment telemetry, RTLS, maintenance system) and protocols. Is the
twin as-built documentation, live monitoring, or simulation? Those are three different
products.

---

## C. Assumptions in force

Not blocking; recorded so they are visible and can be corrected.

| # | Assumption |
| --- | --- |
| C-1 | Metric units, millimetres, throughout. |
| C-2 | Single user per project; no real-time collaboration in Version 1. |
| C-3 | Web application. Electron is not in the TS Edition specification. |
| C-4 | Repository documentation is written in English (see B-2). |
| C-5 | Equipment catalogues and rule sets are versioned in git and loaded at runtime. |
| C-6 | Imported floor plans are used as a raster underlay the engineer works on top of, not parsed for geometry. |
| C-7 | Estimates assume 1–2 full-time developers. |

---

## D. Resolved

| Question | Answer | Settled |
| --- | --- | --- |
| Which product are we building? | MFD-E TS Edition is Phase 1; CLAUDE.md is the long-term vision and does not govern current scope. | Sprint 1.5 |
| Who is the primary user? | Vantive TS engineer, evaluating dialysis installation feasibility. | TS Edition spec §2 |
| Import a plan, or draw from scratch? | **Import** — PDF, PNG, JPG, with a scale-setting step. Sprint 4. | TS Edition spec §5.1 |
| What is the authority for engineering values? | The **manufacturer installation manual**, not a national building code. | TS Edition spec §6 |
| Accepted deliverable? | A PDF installation review report. DXF and DWG are in the specification's Future list. | TS Edition spec §5.5 |
| Sprint numbering | Foundation · Equipment Object System · Rule Engine · PDF Workflow · Report Generation · AI Assistant | Sprint 1.5 |
| Does Version 1 need a backend? | No. Sections 5.1–5.5 require no server; catalogues and rule sets are files. | Sprint 1.5 |
