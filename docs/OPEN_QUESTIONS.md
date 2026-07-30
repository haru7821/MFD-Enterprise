# Open Questions

> What the project still needs from the product owner, and what has been settled.
> Restructured in Sprint 1.5 — resolved items moved to section D so the open ones are
> visible.

---

## A. Blocking — the product cannot state a true verdict without these

### A-1. The AK98 installation data package ← **the one that matters**

This is the single blocker for the product's purpose. Everything else on this page can
wait.

**This is now the only thing standing between the application and a usable answer.** The plan
imports, the scale calibrates, the rooms trace, the rule engine evaluates, the report generates
in two languages — and every clearance finding still reads `RC-110`, "no requirement to compare
against", because there is no threshold. The machinery is finished and empty.

Sprint 5 made the consequence impossible to overlook rather than hiding it: the report's verdict
is **판정 불가 / Inconclusive**, and it counts the missing citations on page one.

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
| Front · Rear · Left · Right service clearance | **The remaining blocker.** The 1200 mm in the rule specification is illustrative. Every clearance finding reads `RC-110` until these arrive. |
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

Finding prose is **also bilingual** — the owner ruled out English-only findings, so
`EVALUATION_RESULT_VERSION` was reopened in Sprint 5 and findings now carry reason codes
(`RC-101`) with each language composed from the code. The findings panel in the editor is
bilingual for the same reason: the screen and the PDF must not describe a finding differently.

**Still open, and narrower:** the rest of the *interface*. Toolbars, panel headings and error
messages are English. Nobody has asked for them to change, and the report — the thing a hospital
receives — is what the decision covered.

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

### B-4. Data residency — gates half of Sprint 6, not all of it

**May project data (floor plans, hospital names, equipment lists) leave the hospital network?**

Still open, and the Sprint 6 architecture is arranged so that it does not block the start:

| If the answer is | Then |
| --- | --- |
| Data may not leave | The deterministic half ships. **Six of the nine features work with no service at all** — including the weighted scoring engine and the installation planner, which both run in the browser. |
| Data may leave | Both halves ship. No request ever carries the plan image — that is a constraint in the contract, not a habit. |
| Self-hosted model and index | Only `apps/ai-service` configuration differs. |

The second part of this question is **settled**: the assistant interprets and explains; it does not
decide. Layout generation is a deterministic solver with the rule engine as its oracle, not a
language model (AD-14). See
[AI_SYSTEM_ARCHITECTURE.md](architecture/AI_SYSTEM_ARCHITECTURE.md) § E for the exact list of what
the model may and may not assert.

The three decisions taken at the Sprint 6 architecture review moved this question's weight **down**:
scoring and planning both landed on the deterministic side, and retrieval-first narrowed what the
model contributes. A "no" answer now costs three features rather than four.

**Needed before steps 8–10 of [SPRINT_6_IMPLEMENTATION_PLAN.md](roadmap/SPRINT_6_IMPLEMENTATION_PLAN.md).**
It also now covers the **knowledge index**: a manufacturer manual is licensed material and a
hospital's own reports are project data, so where the corpus is indexed is the same question.

### B-5. ~~Optimisation objective~~ — **decided**

**A weighted scoring engine, configurable, and the solver maximises total engineering score.** Owner
decision, at the Sprint 6 architecture review. The weights followed in B-5a below.

**Rule compliance is a filter, not a weight.** *Does it comply* is applied before scoring, so no
weight configuration can rank a violating layout at all. What is weighted is `compliance_margin` —
*by how much* — which is real engineering information the old station-count objective discarded
(AD-17).

`LayoutObjective` is deleted; `ScoringModel` and `ScoreBreakdown` replace it. Designed in
[AI_WORKFLOW.md § D](architecture/AI_WORKFLOW.md).

### B-5a. ~~The default weights~~ — **decided**

**Owner decision.** The approved engineering weights, now in
[`standards/scoring/dialysis.json`](../standards/scoring/dialysis.json) at version 1.0.0:

| Criterion | Weight |
| --- | --- |
| Rule compliance *(margin)* | 40 % |
| Installation feasibility | 20 % |
| Maintenance access | 15 % |
| RO piping efficiency | 10 % |
| Electrical routing | 5 % |
| Future expansion | 5 % |
| Walking distance | 5 % |

Also decided: the model stays data-driven; future versions may define multiple scoring profiles; and
**the UI must always show a per-criterion breakdown, never a bare total.** That last one is enforced
in the schema rather than left to each renderer — a `ScoreBreakdown` with a total and no criteria is
invalid.

Two things the weight table required, both recorded rather than resolved silently:

**Drain routing is measured at weight 0.** It was named in B-5's criterion list and is absent from
this table. So it is measured, normalised and printed in every breakdown, contributing nothing —
visible, and weightable by changing one number.

**Station count became a constraint, not a zero-weight criterion.** This is the one part interpreted
rather than transcribed, and the reason is arithmetic: every other criterion *improves as machines are
removed*, so at weight 0 station count would not sit the ranking out, it would win it — a one-station
room scores 1.00 and a twelve-station room 0.65. "Maximise total engineering score" would empty the
room. So the engineer sets a target, the solver satisfies it, the weights rank what meets it, and
`optimise_layout` may never propose deleting a machine. Detail and the numbers in
[AI_SYSTEM_ARCHITECTURE § C-4a](architecture/AI_SYSTEM_ARCHITECTURE.md).

**Still open, and smaller: the normalisation references.** A weight says how much a criterion counts;
a *reference* says what counts as a full score in its own unit. "8,000 mm of RO pipe per station scores
zero" is a developer's estimate of what bad looks like, and a weighted sum is only as meaningful as its
normalisation. Recorded as B-5b rather than treated as settled by B-5a.

### B-5b. The normalisation references

Not blocking; the shipped values are in the same file as the weights and changing one is a data change.
The question is what each criterion's *full score* should be for a typical dialysis ward — 8 m of RO
pipe per station, 12 m of staff walk per station, four addable stations for full marks on expansion.

Worth an engineer's eye because a reference can distort a weight: a criterion whose reference is set
too generously scores near 1.0 for every layout and stops discriminating, which makes its weight
decorative regardless of the number in the table.

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
| ~~C-3~~ | **Now a decision, not an assumption.** Web-native: desktop browsers primary, tablet secondary, installable as a PWA, Chrome/Edge/Safari from one codebase, no desktop-only architecture. Supersedes CLAUDE.md's Electron line. See [PLATFORM_SUPPORT.md](architecture/PLATFORM_SUPPORT.md). |
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
| Report language? | **Bilingual Korean + English** — every section title, field label, finding, warning and recommendation. Findings carry language-independent reason codes. | Sprint 4 close, extended at Sprint 5 |
| Is Sprint 5 a PDF exporter? | **No.** An engineering report engine: the model is the deliverable, and PDF/HTML/JSON are renderers behind one interface. | Sprint 5 |
| Which output formats? | PDF, HTML and JSON implemented; DOCX addable without touching business logic. | Sprint 5 |
| Should the report embed the scanned drawing? | **No, not by default.** Three stored modes: vector-only (default), vector over the scan, scan-only (debug). | Sprint 5 close |
| Which font? | Pretendard, OFL 1.1 — smaller, complete Hangul coverage, verified rendering. Not to be replaced unless a requirement cannot be met. | Sprint 5 close |
| What happens to a glyph the font cannot draw? | An explicit rendering error. **Never a silent substitution.** | Sprint 5 close |
| Does the AI decide anything? | **No.** It proposes, explains, retrieves and summarises; the rule engine judges and a person decides. | Sprint 5 close |
| May an LLM answer from its own knowledge? | **No.** Knowledge retrieval is a *stage* that precedes reasoning: no passages, no prompt, no answer. A question the corpus does not cover gets "not in the indexed corpus". | Sprint 6 architecture review |
| Who produces the installation sequence? | **A deterministic planner** (`packages/ai-planner`), from declared stage dependencies in `standards/sequences/`. Not a model — an installation order must be the same on a second run. | Sprint 6 architecture review |
| Does the plan carry durations or dates? | **No.** Order and dependency only. Duration depends on crew, access, lead times and a contract, none of which this platform holds. | Sprint 6 architecture review |
| Where does the planner's commissioning checklist come from? | **The report's existing checklist**, by item id. A second list could disagree with the signed document. | Sprint 6 architecture review |
| What does the layout solver optimise? | **A weighted engineering score**, configurable as data. Not station count. See B-5. | Sprint 6 architecture review |
| What are the weights? | Compliance 40 · feasibility 20 · maintenance 15 · RO 10 · electrical 5 · expansion 5 · walking 5. Owner decision B-5a. | B-5a |
| May the UI show only a total score? | **No.** A per-criterion breakdown is always displayed; a `ScoreBreakdown` with a total and no criteria is schema-invalid. | B-5a |
| Is station count weighted? | **No — it is a constraint.** At weight 0 in a maximise-total model it would rank the emptiest room first, because every other criterion improves as machines are removed. | B-5a |
| Desktop application or web? | **Web-native**, no exceptions. Desktop browsers primary, tablet secondary, installable as a PWA. No Electron. | Sprint 5 close |
| Offline? | The **application** caches itself. Remembering recent **projects** offline is a future sprint — it means storing hospital floor plans in browser storage, which touches B-4. | Sprint 5 close |
| Liability wording? | Settled verbatim in both languages, at the end of every report. See B-3. | Sprint 4 close |
