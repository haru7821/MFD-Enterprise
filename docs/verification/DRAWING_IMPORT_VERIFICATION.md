# Real Drawing Verification — analysis and information request

> Owner decision, after the AK98 source clarification:
> *"Sprint 6 이후 실제 도면 검증 단계로 진행한다 … 대신 실제 TS 엔지니어가 사용하는 기존 도면 폴더를
> 제공한다."*
>
> 목표: PDF 도면 Import 검증 · Scale calibration 검증 · Coordinate mapping 검증 · Placement 검증 ·
> Optimization 결과 검증 · Report PDF 생성 검증.
>
> 중요 원칙: 도면 데이터에서 없는 값은 추정하지 않는다. Scale 정보가 없으면 calibration required
> 표시. Dimension line이 없으면 measurement unavailable 표시.

**Status of the four steps the owner sequenced:**

| Step | State |
| --- | --- |
| 1. 지원 가능한 PDF 유형 분류 | Done — below, from what the importer actually does |
| 2. 필요한 metadata 목록 작성 | Done — below |
| 3. 첫 번째 검증용 drawing 선정 | **Blocked.** The drawing folder has not been provided. Selection criteria are written below and will be applied the moment it arrives. |
| 4. 추가 필요한 정보 요청 | Done — below |

Nothing in this document is a description of drawings I have seen. No drawing folder exists in
this repository, and none was attached. Steps 1 and 2 are properties of the importer and of what
the product needs; step 3 is a property of the drawings and cannot be answered without them.

---

## 1. Supportable PDF types

Grounded in `apps/web/src/features/plan/planImport.ts`, not in what an importer might ideally do.

**What the importer does today.** A PDF is rasterised — page rendered to a bitmap at
`PDF_RENDER_DPI = 150`, painted on white, capped at `MAX_PLAN_PIXELS = 4096` on the long side, and
then treated exactly like an imported PNG. **The vector content is not read.** No line is extracted,
no text is parsed, no dimension is recovered. That was the owner's Sprint 4 scope — a raster
underlay an engineer traces on top of — and everything below follows from it.

| Type | What it is | Supported | Caveat that matters |
| --- | --- | --- | --- |
| **A. Vector CAD export** | Born-digital PDF from AutoCAD/Revit/ArchiCAD | **Yes, best case** | Rasterised like any other. Crisp at 150 dpi; title block and dimension text legible. |
| **B. Scanned paper drawing** | Raster image wrapped in a PDF | **Yes** | Usually skewed a fraction of a degree. Step 4 of the plan wizard ("Square the drawing") corrects this — `coordinateMapping.rotation`, millidegrees. A plan scanned 3° off square puts every clearance 3° off if it is skipped. |
| **C. Photograph of a drawing** | Phone photo, printed or on screen | **No — must be refused** | Perspective distortion is a projective transform. Our coordinate mapping is scale + rotation + origin only. There is no keystone correction, so a photographed plan calibrates to a scale that is correct along one line and wrong everywhere else — **the most dangerous input this product can accept**, because it looks calibrated. See gap G-1. |
| **D. Multi-page drawing set** | One PDF holding several sheets | **Partly** | `importPlanFile` accepts a `pageIndex`, but the panel never sets it — page 0 always. A drawing set imports its cover sheet. See gap G-2. |
| **E. Encrypted / password-protected** | Access-controlled PDF | **No** | pdf.js rejects it; the error surfaces as a failed import. Acceptable, but the message will not say "this PDF is password protected". See gap G-3. |
| **F. Large format at high detail** | A0 / A1 sheets | **Yes, with loss** | The 4,096 px cap bites. A0 at 150 dpi is 4,967 × 7,020 px, so it is scaled to ~87 dpi effective; A1 lands at ~124 dpi. Fine dimension text and hatching may become unreadable. A2 and A3 are unaffected. See gap G-4. |
| **G. DWG / DXF / IFC / RVT** | Native CAD | **No, by decision** | Refused by name at import. Not a gap — reading DWG is a different product decision, not a missing feature. |

### The four gaps, in the order they would hurt

- **G-1 — a photograph is accepted as if it were a scan.** Nothing distinguishes them. The engineer
  calibrates from two points, the scale is right along that one line, and every measurement away
  from it is wrong by an amount that grows with distance. Everything else on this list produces a
  visible problem; this one produces a plausible number.
- **G-2 — no page selection.** A multi-sheet drawing set silently imports page 1.
- **G-3 — import failures do not distinguish their causes.** Encrypted, corrupt and
  unsupported-but-named-`.pdf` all read the same.
- **G-4 — the resolution cap is silent.** An A0 sheet is downscaled with nothing saying so, and the
  engineer traces detail that is no longer there.

I have not fixed these yet: which of them matters depends on what is actually in the folder, and
fixing G-1 before knowing whether any photographs exist would be building for an imagined input.

### What already behaves as the owner requires

Two of the owner's three principles are existing behaviour, not work to be done:

- **"Scale 정보가 없으면 calibration required 표시."** `Level.coordinateMapping` is null until the
  engineer calibrates. An uncalibrated level makes every rule YELLOW and never GREEN — structurally,
  not by warning — and the report carries an uncalibrated-level caveat. The plan wizard's step 2 has
  no skip button.
- **"도면 데이터에서 없는 값은 추정하지 않는다."** No importer path invents a scale, and no
  evaluator substitutes one. An untaken measurement is `unavailable`, never zero (AD-18).

The third needs a decision:

- **"Dimension line이 없으면 measurement unavailable 표시."** Today the *only* calibration route in
  the interface is two-point: pick two points, type the real distance between them. A drawing with a
  printed scale ratio ("1:100") but no dimension line therefore cannot be calibrated at all — so the
  current behaviour is "calibration impossible" rather than "measurement unavailable".

  Worth being precise about the size of this, because it is smaller than it looks: `stated-ratio` is
  in `CALIBRATION_METHODS`, **and `calibrateFromStatedRatio` is already implemented** in
  `@mfd/document-model` with its own tests. What is missing is the panel wiring — a second
  calibration route in step 2. **Question Q-4 below.**

---

## 2. Required metadata, per drawing

What I need recorded for each sheet in order to verify import, calibration and coordinate mapping
against it. Items marked **essential** block verification of that drawing; the rest change what the
result means.

**Identity**

1. Drawing number / sheet ID — **essential**, it is what a report cites
2. Revision and revision date — **essential**; a plan is true at a revision, like a clearance
3. Project / hospital and site
4. Discipline: architectural, mechanical, electrical, plumbing, or a combined services sheet
5. Which floor the sheet covers, and its elevation above project datum

**Geometry — the part calibration depends on**

6. Sheet size (A0/A1/A2/A3) — **essential**, it decides whether G-4 applies
7. Stated scale on the sheet, e.g. 1:50, 1:100 — **essential** if present; say so explicitly if absent
8. Drawing units — mm or m. A plan dimensioned in metres calibrated as millimetres is off by 1000×
9. **Is there a dimension line with a printed value, and where?** — **essential.** This is what
   two-point calibration measures against. Name one: "the 6,000 mm gridline dimension along the
   south wall" is enough
10. Column grid or origin convention, if the sheet has one
11. North arrow, and whether the plan is rotated on the sheet

**File**

12. Vector export or scan — **essential**, it decides Type A vs Type B, and whether it might be Type C
13. Page count, and which page carries the floor plan — **essential** for anything multi-page
14. Source application and export settings, if known
15. Whether the file is encrypted

**Governance**

16. Any redaction required before the file can live in this repository — patient-identifying
    information, or hospital details the customer has not agreed to publish. **I will not commit a
    real hospital drawing to the repository without an explicit instruction that it may be
    published.** A drawing used only for a local verification run needs no such clearance.

---

## 3. First verification drawing — selection criteria

Blocked on the folder. When it arrives I will pick the first drawing by these criteria, in order,
and report which one and why:

1. **A single-page, vector-export, A2 or A3 architectural floor plan of a dialysis ward** — the case
   with the fewest confounds. If import or calibration fails here, the failure is ours.
2. **With a printed dimension line**, so two-point calibration has something real to measure.
3. **With a stated scale**, so the calibrated result can be checked against the sheet's own claim —
   an independent check on the whole chain rather than on our arithmetic alone.
4. **Whose room is large enough to hold several stations**, so placement and optimisation have
   something to work on rather than one machine in a cupboard.

Then, deliberately second: **the worst sheet in the folder** — the largest, most skewed scan. The
first drawing tells us the path works; the second tells us where it breaks, and the second is what
decides whether the gaps above get fixed.

---

## 4. Information required

### To start drawing verification

- **The drawing folder.** It has not been provided — there is no such directory in this repository
  and nothing was attached to the decision. Everything in section 3 waits on it.
- The metadata in section 2 for at least the first sheet. If it is easier to send the folder without
  it, send the folder — I will infer what I can from each file, list what I could not, and ask again
  rather than guess.
- Confirmation on redaction (item 16).

### To resolve A-1

A-1 is now *"missing installation planning standards and validated installation data"*. It is
resolved by documents, and each one needs a **document number, a revision and a section** —
without all three the schema will not accept a citation, which is deliberate:

- **TS installation standard** covering AK98 service clearance, per side
- **TS installation standard or hospital design standard** covering maintenance access, per side
- **Installation drawing or field-validated data** giving RO water, drain and power port locations
  on the machine
- **TS installation standard** covering installation routing

### To set the AK98 to `datasheet_verified`

The owner assigned `datasheet_verified` to the AK98's dimensions, weight, electrical requirements,
water consumption and operating conditions. **The status mechanism is implemented; the catalogue
record still says `draft`,** because a sourced status requires a citation and the datasheet
reference has not been supplied. Needed:

- Datasheet title or document number
- Datasheet revision
- The section or page giving each of: dimensions and weight; electrical requirements; water
  consumption; operating conditions

The figures already in the record (585 × 620 × 1,305 mm) came from the owner and are unchanged.
Only the citation is missing. Supplying it is a data edit, not a code change.

### Questions

- **Q-1 — photographs.** Will the folder contain photographs of drawings? If yes, G-1 becomes the
  first thing to fix, and my proposal is to refuse them at import rather than warn, on the grounds
  that a warned photograph still produces measurable-looking numbers.
- **Q-2 — multi-page sets.** If the folder is drawing sets rather than single sheets, G-2 blocks
  verification of anything but cover sheets, and page selection goes in first.
- **Q-3 — large format.** If the sheets are A0/A1, is ~90–125 dpi effective resolution enough to
  trace on? I would rather raise `MAX_PLAN_PIXELS` than have an engineer trace a wall they cannot
  quite see — the cost is project file size, which is a real cost and the owner's call.
- **Q-4 — scale ratio without a dimension line.** For a sheet that prints "1:100" and dimensions
  nothing, should I wire the `stated-ratio` route into the plan panel? The engine function exists
  and is tested; this is panel work, not new arithmetic. It is less trustworthy than two-point — it
  assumes the sheet was neither rescaled on printing nor cropped on scanning — so the report would
  label it as such and it would not be offered as the default. The alternative is that such sheets
  stay uncalibrated, which is honest but may make much of the folder unusable.
