# Open Questions

> What the project still needs from the product owner, and what has been settled.
> Restructured in Sprint 1.5 — resolved items moved to section D so the open ones are
> visible.

---

## A. Blocking — the product cannot state a true verdict without these

### A-1. Installation planning standards and validated installation data ← **the one that matters**

> **Redefined by owner decision — AK98 source clarification.** *"The missing A-1 is therefore not
> 'missing AK98 manual'. It is 'missing installation planning standards and validated installation
> data'."*
>
> *"The AK98 manual is not the source for installation planning requirements. Do not block
> development waiting for AK98 service manual."*

This is the single blocker for the product's purpose. Everything else on this page can wait.

**What changed.** A-1 was written as "the AK98 installation data package" — one manual that would
arrive and unblock everything. The owner has established that no such document exists: the AK98
manual is equipment *operating* information, and the clearance and installation-layout figures VantiCAD Layout
needs are not in it. Waiting for it was waiting for the wrong document.

So the blocker is now **two blockers with different owners**, and the data model separates them so
neither can be satisfied by the other (see `packages/object-library/src/schema.ts` — the two source
vocabularies are disjoint, and an installation figure citing a manufacturer document does not parse).

**A-1a — installation planning standards.** The remaining blocker on verdicts. Every clearance
finding reads `RC-110`, *"no requirement to compare against"*, until a threshold arrives, and the
report's verdict is **판정 불가 / Inconclusive**. Each item needs a document number, a **revision**
and a **section** — all three, or the schema will not accept the citation.

| Item | Source the schema will accept | State |
| --- | --- | --- |
| Front · Rear · Left · Right service clearance | TS installation standard, hospital design standard, installation drawing, field-validated data | **Outstanding — the blocker** |
| Maintenance access, per side | as above | Outstanding |
| RO water · drain · power port locations on the machine | installation drawing or field-validated data | Outstanding |
| Installation routing | TS installation standard | Outstanding |
| Installation rates for duration and manpower | `standards/sequences/dialysis.json` (B-7) | Outstanding — planner reports *"Planning rate data not available."* |

**A-1b — the AK98 datasheet citation.** Not a blocker on verdicts; a blocker on the record saying
what the owner has decided it says. The owner assigned `datasheet_verified` to the AK98's
dimensions, weight, electrical requirements, water consumption and operating conditions. **The
status exists and the schema accepts it; the record still reads `draft`,** because a sourced status
requires a document, a revision and a section, and the datasheet reference has not been supplied.
Inventing one would be exactly the failure the status exists to prevent.

| Item | State |
| --- | --- |
| Datasheet document number and **revision** | **Needed** |
| Section or page for: dimensions and weight; electrical; water consumption; operating conditions | **Needed** |
| ~~Width · Depth · Height~~ | Supplied — 585 × 620 × 1,305 mm. Uncited, so `draft`. |
| Weight | Not supplied |
| ~~Planning footprint~~ | **Settled** — AK98 800 × 800 mm, bed 1,000 × 2,100 mm, with the owner's basis recorded. Not a verification item: it is an owner planning decision with no manufacturer citation, and nothing gates on it. |

**Why this cannot be seeded with estimates.** The rule engine can be *built* without any of it. It
cannot be *seeded* with anything true, and a seeded-with-guesses rule engine is worse than none: it
produces a confident feasibility report a TS engineer might sign.

**Until this arrives:** every field group on the AK98 record ships as `draft`, and the engine caps
any result that *reads one of them* at YELLOW.

**Next step, per the owner:** real hospital drawings decide whether A-1a is resolvable from
installation drawings and field-validated data. The drawings have arrived and the first has been
verified end to end — see `docs/verification/HOSPITAL_044_VERIFICATION.md`. **It does not resolve
A-1a.** Hospital_044 dimensions its bed pitch and its overall length; it dimensions no service
clearance around any machine, and neither does the analysis of the other 299 sheets. A layout
drawing shows where equipment went, not how much space its manufacturer or its installer requires
around it, and the two are not interchangeable.

Verification is per group, so these can arrive in any order and each is worth having on its
own — citing the dimensions alone makes the dimension and collision reporting verified while
the clearance findings stay provisional. Flipping a group is a data change; no code change.
See [OBJECT_MODEL.md](data-model/OBJECT_MODEL.md).

Note also that every rule in `standards/rules/dialysis/` is itself `draft`, which caps its
own findings independently. Both sides need their sources before anything reads GREEN.

### A-5. Three traceability gaps in the report — raised by the validation programme

> Owner direction: *"Each reported value must identify: source document · revision · section ·
> observation · calculation path."*

Audited in `docs/roadmap/VALIDATION_PROGRAM.md` § 5. Unknown-stays-Unknown holds throughout; three
things do not, and each needs a decision rather than just work:

- **T-1** — a finding carries its threshold's source but not the calculation path behind its
  *measured* value: which two faces, along which normal, against which neighbour.
- **T-2** — equipment and planner citations are formatted strings; `StandardRow` already carries
  document, revision and section as separate fields and shows the better shape.
- **T-3** — `CalibrationInfo` does not name the printed dimension the scale came from, so the signed
  report is less traceable about its own scale than the verification record beside it.

None is fixed: the direction is validation before features. The fifth item on the owner's list,
*observation*, is vacuous today — no report figure comes from a `knowledge/` observation, and the
rule engine cannot read that package at all — and should stay that way until T-1 to T-3 are closed.

### A-2. Left / right side convention — check this first when the manual arrives

Clearance sides are implemented from **an operator standing at the front, looking at the
machine**: with the front facing south, the operator looks north and their left is west.

A manual that labels its sides from the service engineer's position *behind* the machine
inverts left and right, putting both side clearances on the wrong face of every result.
This cannot be settled from inside the code — only the document settles it. It is item one
of reading the manual, before any figure is transcribed.

### A-3. One real hospital drawing — **resolved**

Sprint 4's acceptance criterion — "a 900 mm machine measures 900 mm against the drawing's own
dimension lines" — is verified. `Hospital_044/dialysis.pdf`, calibrated from its printed 17,600 mm
dimension, reproduces the sheet's other five consistent dimensions to within 0.05 %, and agrees with
its printed 1:100 to 0.027 %. The drawing is plotted about 9° off the sheet, so the rotation step
was exercised too.

Full account in `docs/verification/HOSPITAL_044_VERIFICATION.md`; the record it rests on is
`knowledge/verification/Hospital_044-dialysis.json` and CI re-derives its arithmetic on every push.

### A-4. Is equipment against a wall inside the room? — **resolved**

Raised by the Hospital_044 verification: a room outline traced at the walls' inner faces has
equipment standing *on* it, and `polygonContainsPolygon` refused containment for that case. Every
machine against a wall reported RED *"extends beyond the room"* while every corner of it was inside
the room, and a sound layout came out `not_acceptable`.

**Owner decision:** *"A footprint touching the room boundary is considered contained. Only geometry
extending outside the boundary is a containment failure. Treat boundary contact as topological
contact, not as a crossing. Clearance evaluation remains completely separate from containment
evaluation."*

Implemented in `@mfd/cad-engine`: `segmentsProperlyCross` distinguishes geometry passing *through*
geometry from geometry *touching* it, and containment additionally refuses a room vertex swallowed
by a footprint. Re-running the verification took the drawing from 10 RED to 0 with the calibration
and the knowledge base byte-identical; a machine one millimetre over the wall still reports RED. Full
account in `docs/verification/HOSPITAL_044_VERIFICATION.md` §5 and §5a.

The second option — tracing room outlines at a clearance from the wall face — was not taken, so a
traced room still means the room.

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

### B-7. ~~Labour rates and crew sizes~~ — **decided**

> **Approved.** *"Do not estimate manpower or installation duration. Every value must come from a
> referenced installation standard. Planning calculations may use only sourced installation rates …
> Never interpolate. Never estimate. Never infer. Unknown is always preferred over an unsupported
> value."*

The model, as approved:

```
InstallationRate { id, stage, hoursFixed, hoursPerStation, minimumPersons, recommendedPersons, source }

Duration = hoursFixed + (hoursPerStation × stationCount)
Manpower = minimumPersons, recommendedPersons
```

| Requirement | Where it is held |
| --- | --- |
| Every value from a referenced standard | `InstallationRate.source` is required, and EV-7 makes a rate source with no citation unrepresentable |
| Calculations use only sourced rates | EV-6: a calculation names a rate id **if and only if** it names that rate's citation |
| Formula, input values, rate id, citation | All four on `Calculation`, attached to the figure — so a printed plan can be checked without a data file |
| Any required rate missing → Unknown | Every field of a rate is required at the schema. **A partial rate is not a rate**, so there is no half-formula to evaluate |
| The report states *"Planning rate data not available."* | `InstallationPlan.ratesAvailable`, and the exact sentence as a label. Verbatim in English, because a paraphrase would be a different document from the one approved |
| Future updates need no code changes | `standards/sequences/dialysis.json` → `installationRates`. Verified by supplying rates as a pure data edit and watching the whole feature come on |

**The shipped file has `installationRates: []`**, because no installation standard has been
supplied. So every duration and every crew figure is Unknown today, and the report says so in the
owner's words. Supplying one is a data edit: add an entry naming the stage, the four figures and the
standard, and the panel, the plan and the PDF all start reporting real hours with the arithmetic
shown.

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
| Which product are we building? | VantiCAD Layout TS Edition is Phase 1; CLAUDE.md is the long-term vision and does not govern current scope. | Sprint 1.5 |
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
| Is station count weighted? | **No — it is a constraint.** Satisfied before optimisation begins; candidates missing the requested count never reach the scoring stage, and the solver may never improve a score by removing a station. | B-5a, confirmed |
| Where do routing distances measure from? | **`Level.referencePoints`**, `DOCUMENT_VERSION` 4. Seven kinds, placed by the engineer. A level with none reports those criteria inconclusive, never zero. | Sprint 6 step 2 |
| Desktop application or web? | **Web-native**, no exceptions. Desktop browsers primary, tablet secondary, installable as a PWA. No Electron. | Sprint 5 close |
| Offline? | The **application** caches itself. Remembering recent **projects** offline is a future sprint — it means storing hospital floor plans in browser storage, which touches B-4. | Sprint 5 close |
| Liability wording? | Settled verbatim in both languages, at the end of every report. See B-3. | Sprint 4 close |

### The audit round — decisions D1 to D5

Recorded here because they were not. They existed only in commit messages, and the consequence
arrived quickly: D3 reached the lead developer as a *contradiction* of A-4, was implemented, broke an
architectural guard, and had to be stopped and escalated. It was never a contradiction — A-4
separates clearance from **containment**, and the guard had been written wider than that. A decision
that lives only in a commit message is a decision the next person meets as a surprise.

| Question | Decision | Guard it touches |
| --- | --- | --- |
| May an unavailable criterion be renormalised out of the total? | **No.** The divisor is the whole model's weight, so an unmeasured criterion contributes nothing and a total can only be earned. Below the scoring model's `minimumCoverage` there is no total at all — `null`, not zero. Dividing by the *available* weight meant deleting evidence raised the score, to a perfect 1.0000 at coverage 0.20. | D1 · `score.ts`, `rank.ts`, `optimise.ts` |
| What is `minimumCoverage`? | **0.25** — the ceiling reachable today, so a total is offered only when the engineer supplied every input obtainable. Measured against the shipped catalogue: three criteria are unmeasurable on every project (0.75 of the model), so reachable coverages are {0.05, 0.10, 0.15, 0.20, 0.25}. Decided by the GM; reversing it is one number in `standards/scoring/dialysis.json`. | D1 · pinned by `score.test.ts` |
| Does contact count as collision? | **No. Proper overlap only**, and one predicate for every subsystem. Contact with an obstruction used to be `RED measured=0` while the same contact between two machines, and between a machine and a room, was `GREEN`. | D2 · `polygonsOverlapAnywhere`, cross-checked against `polygonsOverlap` in `sat.test.ts` |
| Must clearance see walls? | **Yes, `wall` and `obstruction`** — measured with the equipment's own service-clearance threshold, no new standard. `space_outline` stays invisible to it, so **A-4 is narrowed, not overturned**. A non-convex wall abstains (`RC-905`), mirroring `SC-907`. And `RC-103` no longer asserts that *nothing* stands there, because with the room outline excluded the engine cannot know: it now names what was searched. | D3 · `independence.test.ts` narrowed to the room outline; behavioural test in `boundary.test.ts` |
| Concave rooms and `compliance_margin`? | **Report unavailable** (`SC-908`). No AABB approximation — it over-reported 9.6× on an L-room. The test is **rectangularity, not convexity**: a bounding box equals its polygon only for an axis-aligned rectangle, and a rotated rectangle is convex with a strictly larger box. | D4 · `criteria.ts`, pinned by `score.test.ts` |
| What happens when a placement cannot be evaluated? | **The level cannot receive a PASS.** `RC-903` names the placement whose catalogue record is missing; `RC-904` withdraws the neighbour passes on that level, because clearance and equipment collision both measure *against* the object that was dropped. Containment is unaffected — it does not depend on other objects. | D5 · `EVALUATION_RESULT_VERSION` 3 |
| Is support counted per file or per facility? | **Per independent facility** — `support.facilities`, which is what `isPattern` gates on. Threshold stays 3; what is counted changed. Measured: `station_pitch` claimed 117 files against **24** sites. The distribution also collapses the `.dwg`/`.pdf` twins, keyed by plan **and value** so a sheet recording two genuinely different runs keeps both: `corridor_width`'s median was **2,700 → 2,040 mm**, 32 % out. | D6 · `aggregate.ts`, `provenance.ts`, pinned by `knowledge.test.ts` |
| What does "completed the programme" mean? | **A human-confirmed run.** Batch execution alone is not completion. The ledger now carries two counts — `completed` (ran every stage **and** a row carries `confirmedBy`) and `batchComplete` (ran every stage) — and a batch never signs its own rows. Both read 0 over 306 pages; the collapsed single count is what let a document claim *"two complete all nine stages"* against a ledger saying zero. | D7 · `confirmedBy` on `corpusRowSchema`, enforced by `corpusValidationSchema.refine()` rules that `validate-corpus.ts` runs against the bytes it writes |
| Does D4's rule extend to `maintenance_access`? | **Yes**, `SC-908` on any non-rectangular room. Same substitution, opposite harm: D4's box over-reported headroom; this credited a service face in the **notch** of an L — outside the room, inside its box — as somewhere a technician can stand. The guard sits **after** the `SC-904` zone check by the GM's condition, so the reported reason stays the one an engineer can act on (*supply the AK98 manual*, A-1) rather than one they cannot (*reshape the building*). Coverage cost today: **zero** — measured, both catalogue objects declare all four `serviceClearance` sides `null`, so this criterion already abstains with `SC-904` on every real project and the guard is unreachable in production. It is therefore pinned by a test using an object that declares clearances. | D8 · `criteria.ts`, pinned by `score.test.ts` |
| Where do human confirmations live, so a re-run cannot destroy them? | **A separate `knowledge/validation/confirmations.json`**, keyed and merged in by the builder. The ledger stays fully regenerable and the one datum that cannot be regenerated sits in a file no batch writes. Found by review: nothing in the tree ever wrote a non-null `confirmedBy`, the builder hardcoded `null` and overwrote the ledger, so D7's distinction was unobservable in production and `completed` was structurally pinned at 0. | D9 · `confirmationSchema` + `scripts/lib/corpusLedger.ts`, pinned by `verification.test.ts` |
| What does a confirmation bind to? | **`drawingId` + `page` + `sha256` *and* the row's outcome** (`reached`, `stoppedAt`, `discrepancies`). If any differs it does not apply and the row is unconfirmed. A stale confirmation is **retained** in the file and never deleted — a person's act is evidence — it simply stops asserting anything. Evidence: `byStage.room` moved 8 → 15 under review with no row's identity changing, which is exactly where a signature bound to the hash alone would have stayed alive. | D10 · `rowFingerprint`, `confirmationFor`, `staleConfirmations` |
| May a ledger row carry more than one confirmation? | **One applies; none is discarded.** The row takes the earliest matching confirmation, and every further one on the same fingerprint is recorded in the ledger's `unapplied` array as a **duplicate**, kept distinct from a **stale** one because the actions differ: stale means a signature stopped applying, duplicate means it was recorded but another already stands on that row. Neither is ever deleted, and both are in the committed artefact rather than only in a console nobody keeps. **Order:** the parsed instant, then name, then the raw `at`, then basis — every key needed. Two acts inside one millisecond are the *same* instant (`Date.parse`'s floor) and are separated by spelling, which can apply the later one; that stands, because a full-precision parser buys resolution no signature possesses and a format restriction would refuse ordinary `isoformat()` output. A `duplicate` entry must name a row carrying an applied confirmation of the same kind ordered **strictly earlier**, so the ledger alone proves the rule was applied; the array's order is **total** — signature, then row fingerprint, then the confirmation's own serialisation — so it does not follow the file's; the last key is there because two acts differing only in the *listing* order of their discrepancies tied on the first two. And a byte-identical entry twice is refused by `confirmations.json` itself, naming the entry: one act transcribed twice is not two acts, and every alternative required the product to guess which it was. The `Date.parse` soundness this rests on is measured by `instantOrder.test.ts` — 73,332 accepted strings, no `NaN`, no millisecond-resolution inversion — rather than asserted from a deleted probe. `at` is therefore an ISO-8601 instant (`z.string().datetime({ offset: true })`), written in the signer's own zone: not UTC-only, because a hand-converted wrong time is a valid-but-false record and worse than a rejection. This was first written as "earliest by (`at`, `name`)" over free text, and the byte-stability that sentence claimed was false three times over — `08/01/2026` sorted before an ISO string; `…T09:00:00+09:00` is earlier than `…T02:00:00Z` yet sorts after it; and two signers differing only in `basis` tied, handing the choice back to file order via `Array.sort`'s stability. `localeCompare` made it machine-dependent as well. Deliberately **not** a build error — two people signing the same row is a benign act and must not stop a 306-page batch. Defect it closes: `confirmationFor` used `.find()`, so a second signature disappeared silently, uncounted and unreported, which is the one datum D9 exists to protect. `confirmedBy` stays a single signer; co-signature as a list is not built, and stays available additively if anyone ever signs twice in earnest. | D11 · `confirmationFor`, duplicate reporting alongside `staleConfirmations` in `scripts/lib/corpusLedger.ts` |
| May a person confirm a run that stopped? | **Yes — as a separate act, with a separate field and a separate count.** Confirming *"this stop is correctly diagnosed"* is not confirming a completed run, and the two may never be summed: `completed` and `batchComplete` keep D7's meaning exactly, stop confirmations are counted on their own and are never folded in nor presented as progress towards completion. A signer states which act they perform through a `kind` discriminator on `confirmationSchema`; D10's binding applies unchanged, so a stop confirmation stops applying the moment `stoppedAt` or a discrepancy classification moves. Mirror invariants: a completion confirmation requires `stoppedAt === null`, a stop confirmation requires `stoppedAt !== null`. Why not "no": measured, **306 of 306 rows stopped**, so under the D7 refine alone nothing in the corpus is legally signable and the signature mechanism cannot be exercised against real data until room understanding lands. And the corpus's actual output today *is* the classification of its 306 stops — a machine's claim until a person has checked one. | D12 · `confirmationSchema.kind`, `stopConfirmedBy` on `corpusRowSchema`, `totals.stopsConfirmed` |

> **On the numbering.** The GM issued two decisions labelled D8 and D9 in a session that had already
> produced a different D8. Renumbered here in the order they were decided — `maintenance_access` is
> D8, the confirmations file D9, its binding rule D10 — because this table, not a commit message, is
> where a decision is looked up. That is the same failure D1–D5 caused when they lived only in commit
> messages.

| May a tie be presented as a ranked #1? | **No.** Candidates indistinguishable under the available evidence — equal `total` **and** equal `coverage` — share a dense rank and are shown as **Tied / 동점**, with the same score and coverage beside the word. A deterministic internal order is still needed and still exists (candidate id); what changed is that it is no longer *presented* as significance. Measured: on the four-station fixture `perimeter` and `rows` scored an identical 0.283333333 with `compliance_margin` unavailable on both, and the one labelled **#1** was chosen by `'p' < 'r'`. In the browser's room all **three** proposals tie. | D13 · `denseRanks` in `rank.ts`, shared with `optimise.ts`; browser proof in `layout.spec.ts` |
| May a generated artefact emit an empty `frequencies`? | **No — omit the key.** `[]` was carrying two different meanings at once: *no observations exist* and *this kind never collects frequencies*. Both were live — the one populated kind passed a literal `[]`, and every kind that computes frequencies has no observations. Optional rather than nullable, because `null` would be a third spelling of the same ambiguity. `KNOWLEDGE_VERSION` 1 → 2: the shape widened, but the *meaning* changed, which is what a version identifies. | D14 · `schema.ts`, `aggregate.ts`, pinned by `knowledge.test.ts` |

| What unit does `support` count? | **Distinct plans**, and the field is renamed `plans` to say so. Counting `drawingId` counted *files*: the corpus ships 75 plans in two export formats, so `station_pitch` reported **117** drawings of support over **71** sheets, `station_row_spacing` 36 over 21, `corridor_width` 18 over 12. D6 fixed `facilities` and the median's dedup and left this one counting files. Renamed rather than silently renumbered — a figure that keeps its name while changing its value is this project's recurring failure, so a stale quotation should fail to parse. The file count is not lost: `support.sources` still lists every one. Extended to `Frequency.plans` for the same reason, while it is still free — that table decides which value is shown as commonest practice, and an export format must not vote twice. `KNOWLEDGE_VERSION` 2 → 3. | D15 · `provenance.ts`, `schema.ts`, `aggregate.ts`, pinned by `boundaries.test.ts` |

| What order is `RankedLayout.strategies` frozen in? | **`CANDIDATE_STRATEGIES`' declared order**, via `compareStrategies` — the same order the `AR-105` sentence is rendered in. It was a bare `.sort()`, so the exported array read `['perimeter', 'rows']` while the sentence built from it read *"rows and perimeter"*. The field is the machine-readable form of what `AR-105` states in prose, not a second datum with a second audience, so it may not have an order independent of the sentence: one fact with two renderings that disagree is one of them being wrong, and a consumer choosing between them is choosing which of our own statements to believe. Neither order is engineering significance — the strategies converged, they did not compete — so D13 is untouched either way; what settles it is that the array has no meaning apart from the sentence. Consequence, stated because it is a coupling: adding a strategy reorders the public field as well as the prose. Nothing external is bound to the old order — the field is new this phase and appears in no issued artefact. The raw array is **not** rendered in the UI; the engineer reads the sentence. | D16 · `collapseByGeometry` in `rank.ts`, pinned by `rank.test.ts` Cases A and B |

**The standing rule behind all of them**, restated by the owner in each round: *"If something cannot
honestly be measured, do not estimate it."* Where implementation must choose between optimistic,
inferred, approximate and abstaining behaviour, it abstains. The goal is not to maximise PASS; it is
to maximise **truthful** PASS.
