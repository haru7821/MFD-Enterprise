# Open Questions

> What the project still needs from the product owner, and what has been settled.
> Restructured in Sprint 1.5 — resolved items moved to section D so the open ones are
> visible.

---

## A. Blocking — the product cannot state a true verdict without these

### A-1. The AK98 installation data package ← **the one that matters**

This is the single blocker for the product's purpose. Everything else on this page can
wait.

**This is now the only thing standing between the application and a usable answer.** The
plan imports, the scale calibrates, the rooms trace, the rule engine evaluates, and every
clearance finding still reads "threshold unknown" — because there is no threshold to
compare against. The machinery is finished and empty.

Phase 4.5 narrowed it: the AK98's **dimensions** are now real (585 × 620 × 1305 mm, plus an
800 × 800 mm design footprint). What is still missing is the **service clearances** and the
**citation** — a document, a revision and a section. Dimensions decide what fits; clearances
decide whether it may be installed, and only the manual can say.

The rule engine can be *built* without it. It cannot be *seeded* with anything true, and a
seeded-with-guesses rule engine is worse than none: it produces a confident feasibility
report a TS engineer might sign.

**Needed, from the manufacturer installation manual:**

| Item | Why |
| --- | --- |
| Manual document number and **revision** | A clearance is true "for the AK98 at revision X". Without the revision we cannot say what a report was based on, or what a future revision invalidates. |
| Section reference for each figure | Specification section 6 requires source information per rule. "Manufacturer Manual" alone does not meet that bar. |
| ~~Width · Depth · Height~~ | **Supplied** — 585 × 620 × 1305 mm, Phase 4.5. Still uncited, so that group stays `draft`. |
| Weight | Not supplied |
| Front · Rear · Left · Right service clearance | **The remaining blocker.** The 1200 mm in the rule specification is illustrative. Every clearance finding reads "threshold unknown" until these arrive. |
| Power specification | Voltage, phase, rating |
| RO water specification | Supply pressure, flow, connection type |
| Drain specification | Diameter, connection type, height |
| Environmental specification | Ambient temperature, humidity, heat output |
| ~~One sentence for `designFootprint.basis`~~ | Still wanted for the report, but **not a verification item.** The footprint is an owner planning decision with no manufacturer citation (Phase 4.5), so nothing gates on it. |

**Until this arrives:** every field group on the AK98 record ships as `draft`, and the engine
caps any result that *reads one of them* at YELLOW.

Verification is per group, so these can arrive in any order and each is worth having on its
own — citing the dimensions alone makes the dimension and collision reporting verified while
the clearance findings stay provisional. Flipping a group is a data change; no code change.
See [OBJECT_MODEL.md](data-model/OBJECT_MODEL.md).

Note also that every rule in `standards/rules/dialysis/` is itself `draft`, which caps its
own findings independently. Both sides need their sources before anything reads GREEN.

### A-2. Left / right side convention — check this first when the manual arrives

Clearance sides are implemented from **an operator standing at the front, looking at the
machine**: with the front facing south, the operator looks north and their left is west.

A manual that labels its sides from the service engineer's position *behind* the machine
inverts left and right, putting both side clearances on the wrong face of every result.
This cannot be settled from inside the code — only the document settles it. It is item one
of reading the manual, before any figure is transcribed.

### A-3. One real hospital drawing

Sprint 4's acceptance criterion "a 900 mm machine measures 900 mm against the drawing's own
dimension lines" is unverified. The maths is tested and a synthetic plan round-trips
correctly, but nobody has calibrated against a real printed dimension line and confirmed
the result.

**Needed:** one PDF floor plan of the kind TS engineers actually receive — ideally one that
is scanned slightly off square, since that is the case the rotation step exists for.

---

## B. Needed before their sprint, not before now

### B-1. Deployment and data location — before any backend work

Cloud SaaS, on-prem at each hospital, or a purely local desktop tool?

Less urgent than it was: the MVP feature list (specification 5.1–5.5) needs no server, so
Version 1 can ship without `apps/api` at all. The question returns when project sharing or
a central equipment catalogue becomes a requirement.

### B-2. ~~Report language~~ — **decided**

**Bilingual Korean + English throughout the report.** Every section title and field label
carries both languages. Owner decision, before Sprint 5.

Consequences, designed in
[REPORT_ENGINE_DESIGN.md § D](architecture/REPORT_ENGINE_DESIGN.md): font embedding becomes
mandatory (the standard 14 PDF fonts have no Hangul), one family covers both scripts, and
labels live as keys in a single reviewable catalogue rather than as prose in the generator.

**Still open, and narrower:** the *interface* language. The editor is English today, and that
was not part of this decision. Also open — item 8 in that document's decision table — whether
finding prose ("Station 4 overlaps Station 5 by 500 mm") stays English for Sprint 5.
Translating it properly means findings carrying a reason code plus parameters instead of a
sentence, which reopens `EVALUATION_RESULT_VERSION`.

### B-3. ~~Liability posture~~ — **decided**

The notice below appears at the end of every report, verbatim, in both languages. Owner
decision. Frozen as a constant and asserted character for character, because the failure mode
is a well-meant edit.

> This report is generated to support engineering planning and installation review. Final
> installation approval shall be based on applicable regulations, manufacturer documentation,
> and site verification.

> 본 보고서는 설치 계획 및 기술 검토를 지원하기 위한 자료입니다. 최종 설치 승인 및 시공은
> 관련 법규, 제조사 공식 문서 및 현장 실측 결과를 기준으로 수행되어야 합니다.

Traceability was already designed in; this settles the wording. Placement details in
[REPORT_ENGINE_DESIGN.md § G-2](architecture/REPORT_ENGINE_DESIGN.md).

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
| C-4 | Repository documentation is written in English. The **report** is bilingual (B-2); internal engineering documents are not, and nobody has asked for them to be. |
| C-5 | Equipment catalogues and rule sets are versioned in git and loaded at runtime. |
| C-6 | Imported floor plans are used as a raster underlay the engineer works on top of, not parsed for geometry. |
| C-7 | Estimates assume 1–2 full-time developers. |
| C-8 | A project is one file the engineer keeps and shares themselves. No server, no autosave — an autosave that quietly went nowhere would be worse than a visible download. |
| C-9 | The imported plan is embedded in the project file as base64. A large scan makes the file a few megabytes; external asset storage is a later decision. |
| C-10 | Room membership (`placement.spaceId`) and room geometry are allowed to disagree. The rule engine reports on the geometry; the reference records the engineer's intent. |

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
| Does a Space own its Placements? | **No.** Placements hang off `Level` with a nullable `spaceId`, so a machine can be placed before its room is drawn and survives the room being deleted. | Sprint 4 |
| Is a room outline a field on Space? | **No.** `Boundary` is its own entity with a `kind`, so a structural column needs no fake room. | Sprint 4 |
| Snapshot undo or command undo? | **Commands with explicit inverses.** A Level embeds its plan image, so snapshots would allocate megabytes per drag frame. | Sprint 4 |
| Are plan import and calibration undoable? | **No.** Undoing a calibration would silently reinterpret every placement's geometry. Both are explicit acts, repeatable by hand. | Sprint 4 |
| Polygon geometry — library or internal? | **Internal.** Rooms are concave, so the convex-only separating axis test cannot answer containment; and the tolerance and epsilon policy a clearance verdict rests on should be visible. | Sprint 4 |
| Is the footprint the machine's size? | **No.** `manufacturerDimensions` is immutable reference data nothing computes with; `designFootprint` is the planning area every engine measures. The footprint must never be written back over the dimensions. | Phase 4.5 |
| Can a generic planning object have no manufacturer? | **Yes.** `manufacturer` and every manufacturer dimension are nullable. A dialysis bed is a footprint, not a product. | Phase 4.5 |
| Is verification a property of the record or the field? | **The field group.** Six groups each carry their own status and source, so verified and draft data coexist and a verified figure is never downgraded because another is unknown. A finding is provisional only if a group *it read* is. | Phase 4.5 |
| Does the design footprint need a citation? | **No.** It is an owner-defined planning property with no manufacturer document behind it. `basis` records the reasoning in prose and nothing gates on it. | Phase 4.5 |
| Report language? | **Bilingual Korean + English**, every section title and field label in both. | Sprint 4 close |
| Liability wording? | Settled verbatim in both languages, at the end of every report. See B-3. | Sprint 4 close |
