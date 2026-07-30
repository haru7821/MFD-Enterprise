# Sprint 5 — Report Engine Architecture

> **For review. Not implemented.**
> Scope: TS Edition specification §5.5 — PDF Installation Review Report.
> Prerequisite state: Sprint 4 + Phase 4.5, `DOCUMENT_VERSION = 2`,
> `EVALUATION_RESULT_VERSION = 1`.

---

## A. What the report is for, and the one decision that shapes everything else

A TS engineer hands this document to a hospital. Someone signs it. Six months later a
manual is revised and somebody asks what the assessment was based on.

So the report is not a printout of the screen. It is **a record of an assessment**, and its
job is to be defensible: every figure traceable to a source, every verdict traceable to a
rule, and an honest statement of what could not be concluded.

That last part is not hypothetical. **With the catalogue in draft, today's report contains
no GREEN at all** — every clearance finding reads "threshold unknown". A report generator
that presents that as a clean bill of health is worse than no report. So the design treats
"this review could not conclude" as a first-class output, not an error path.

### The decision: vector, and derived, not captured

| | |
| --- | --- |
| **Vector PDF, not a canvas screenshot** | The geometry lives outside the renderer (AD-2), so the drawing can be re-emitted at print resolution. A screenshot of a 1600 px canvas is unreadable at A3 and cannot be measured. |
| **Derived at generation time, never stored** | A stored verdict is stale the moment a placement moves. The report is a pure function of (document, catalogue, rule set) — see AD-3. |
| **Generated from the document, not the editor** | `@mfd/report-engine` must not import React or Konva. That is what lets the same report be produced by a server in a later sprint, and compared against the browser's. |

---

## B. Architecture

```
                 ┌─────────────────────────────────────────┐
                 │  @mfd/report-engine   (pure TypeScript) │
                 └─────────────────────────────────────────┘
MfdDocument ──┐
Catalog     ──┼──► buildReport() ──► ReportModel ──► layout() ──► PageBox[] ──► emitPdf()
RuleSet     ──┘        │                  │              │                          │
                       │                  │              │                          │
                  evaluate()         plain data,     paged boxes,              PDF bytes
                  per level          JSON-safe       still no PDF
```

Four stages, deliberately separable:

| Stage | Input → output | Why it is its own stage |
| --- | --- | --- |
| **1. Build** | document + catalogue + rule set → `ReportModel` | Pure data. Testable without a PDF library, diffable, and the thing a future HTML or DOCX renderer would also consume. |
| **2. Layout** | `ReportModel` → `PageBox[]` | Where pagination and page breaks happen. The stage that decides a 200-row table spans four pages. |
| **3. Emit** | `PageBox[]` → PDF bytes | The only stage that knows a PDF library exists. |
| **4. Drawing** | level geometry → vector paths | Shared by stage 2; re-emits the layout at print scale from millimetres. |

**Stage 1 is where the value is.** A `ReportModel` is a complete, ordered, JSON-safe
description of the document — which means the whole report can be asserted in unit tests
with no PDF parsing anywhere, and a bug in the numbers is caught before a bug in the
typography can hide it.

### Why not render HTML and print it

Considered and rejected. It would mean a headless browser in the pipeline — which
contradicts "no DOM in packages/", puts Chromium on the server, and makes the report's
appearance depend on a browser version. It would also make a paginated table with repeating
headers a CSS fight rather than a loop.

---

## C. The report model

Ordered exactly as the specification lists it, plus what traceability requires.

```ts
interface ReportModel {
  readonly reportVersion: 1;
  readonly generatedAt: string;              // ISO, injected — never a clock
  readonly documentVersion: number;
  readonly evaluationResultVersion: number;  // stamped, so an old report is readable

  readonly project: ProjectSection;
  readonly conclusion: ConclusionSection;    // first page, before the detail
  readonly levels: readonly LevelSection[];
  readonly equipment: BomSection;
  readonly checklist: ChecklistSection;
  readonly signature: SignatureSection;
  readonly provenance: ProvenanceSection;
}
```

### Section by section, against the owner's list

| # | Owner asked for | Section | Source |
| --- | --- | --- | --- |
| 1 | Project information | `project` | `Project` — name, customer, reviewed by, created/updated |
| 2 | Drawing information | `LevelSection.drawing` | `PlanImage` — file name, format, page, pixel size, imported at |
| 3 | Calibration information | `LevelSection.calibration` | `ScaleCalibration` — method, picked points, typed distance or stated ratio, dpi, timestamp |
| 4 | Coordinate mapping | `LevelSection.mapping` | mm/px, origin pixel, rotation, **and whether it exists at all** |
| 5 | Equipment list (BOM) | `equipment` | Catalogue records, grouped by model, counted across levels — **both** manufacturer dimensions and design footprint |
| 6 | Placement table | `LevelSection.placements` | One row per machine: label, model, position, rotation, room |
| 7 | Rule evaluation | `LevelSection.findings` | `EvaluationReport`, grouped and ordered |
| 8 | Threshold source | inside every finding row | `appliedValue`, `thresholdOrigin`, `source.{document, revision, section}` |
| 9 | Draft data warning | `conclusion.dataStatus` + per-row marks | `hasDraftInputs`, `dataStatus` per finding, catalogue `dataStatus` |
| 10 | Installation checklist | `checklist` | Derived from findings — see E |
| 11 | Engineer signature block | `signature` | `project.reviewedBy` + blank fields to sign |
| — | *Provenance* | `provenance` | Rule set id/version, catalogue versions, app version, contract versions |

**Item 12 is mine, and I think it is required rather than nice:** the *conclusion*, on page
one. A twelve-page report whose verdict is on page nine is a report whose verdict gets
missed. See D.

### Two shapes worth arguing about now rather than later

**`levels` is a list, not a single level.** Phase 4.5 made multi-level projects real. A
report that silently covered only the level that happened to be selected would be a report
that omits a floor without saying so.

**The BOM is project-wide; the placement table is per level.** An engineer ordering
equipment wants one number per model for the whole job. An engineer installing on the third
floor wants the third floor's machines. These are two different tables, and merging them
serves neither.

**The BOM carries both sizes, in separate columns, labelled.**

| Column | For the reader who is |
| --- | --- |
| Manufacturer W × D × H | Checking a delivery, or a doorway, or a lift |
| Design footprint W × D | Reading the drawing, and asking what area was reserved |
| Footprint basis | Asking *why* that area — the one sentence behind it |

They are different numbers and they answer different questions: an AK98 is a 585 × 620 ×
1305 mm machine planned at 800 × 800 mm. A report that printed one figure without saying
which would recreate the confusion the split was made to end — and a hospital measuring a
doorway against a planning footprint would get the wrong answer.

A record with **no** manufacturer dimensions — a generic dialysis bed, planned at
1,000 × 2,100 mm — leaves that column empty rather than repeating the footprint into it.
An empty cell says "this is not a product"; a duplicated figure says something false.

---

## D. The conclusion, and what it says when nothing is verified

```ts
type Verdict = 'not_acceptable' | 'review_required' | 'acceptable' | 'inconclusive';
```

| Verdict | When | Reads as |
| --- | --- | --- |
| `not_acceptable` | Any RED | "N findings prevent installation as drawn" |
| `review_required` | No RED, some YELLOW from real comparisons | "N findings require review" |
| `acceptable` | Every finding GREEN | "No findings" |
| `inconclusive` | **Every** finding is YELLOW for want of a threshold or a calibration | "This review could not be completed" |

`inconclusive` is the honest name for today's output, and it is the reason the fourth
verdict exists rather than folding into `review_required`. "Review required" implies the
assessment ran and raised questions. What actually happened is that it could not run: the
manual has not arrived, so there is nothing true to compare against.

The conclusion section therefore carries, in plain words:

- the verdict and the counts behind it
- **why** it is inconclusive, if it is: how many findings had no threshold, and how many
  levels were uncalibrated
- what would change it — which is a sentence naming the missing manual, not a shrug

This is not a technical decision dressed up. It is the difference between a document that
says "we assessed this and it is fine" and one that says "we cannot assess this yet, and
here is exactly what is missing" — and only one of those is true today.

> **Owner decision needed (B-3 in OPEN_QUESTIONS):** the liability sentence. Traceability
> is designed in; the wording is not mine to write.

---

## E. The installation checklist

The specification asks for one. It is not clear it should be a fixed list, and a fixed list
is the wrong answer here: a checklist of generic items ("verify power supply") that ignores
what the drawing actually shows is a form, not an engineering output.

**Proposed: derive it from the findings, and mark what could not be checked.**

| Checklist item | Comes from |
| --- | --- |
| One item per RED finding | "Resolve: Station 12 overlaps Column C4 by 150 mm" |
| One item per unresolved YELLOW | "Confirm on site: front clearance for Station 4 — no manual figure available" |
| One item per uncalibrated level | "Calibrate the 4F drawing before relying on any measurement from it" |
| One item per draft catalogue record in use | "Replace placeholder figures for Vantive AK98 with the installation manual" |
| Fixed items from the rule set | Only if the rule data declares them — never hard-coded here |

Every item is traceable to a finding or a data gap, so the checklist cannot drift out of
step with the assessment. And an engineer who works through it has, by construction, worked
through everything the tool could not conclude.

> **Owner decision needed:** whether the hospital also expects a *standard* checklist
> independent of the drawing (commissioning steps, handover items). If so it belongs in
> `standards/`, as data, alongside the rules — not in the report generator.

---

## F. The layout drawing

Re-emitted as vector paths from model millimetres, at a print scale chosen to fit the page.

| Element | Drawn as |
| --- | --- |
| Plan underlay | The embedded raster, placed by the same `pixelToModel` → page transform |
| Room outlines | Closed paths, labelled with name, function and area |
| Obstructions | Closed paths, hatched, labelled |
| Equipment | Footprint rectangles at catalogue size, labelled |
| Findings | RED and YELLOW markers keyed to the finding table's row numbers |
| Scale bar and north mark | From the coordinate mapping |

**The keying matters.** A drawing with problems circled and a table of findings, with no way
to tell which circle is which row, makes the reader do the join by eye. Numbering both is
one line of code and the difference between a usable report and a decorative one.

Two honest constraints:

- **A page-scale drawing cannot show a 900 mm machine's label at 1:200.** Labels drop below
  a legibility threshold, exactly as they do on screen, and the placement table carries what
  the drawing cannot.
- **The plan underlay is a raster.** Printing a 3000 × 2000 scan into a PDF is the one place
  the output is not vector, and the file size follows from that. Unavoidable while the
  underlay is raster by design (C-6).

---

## G. Package and file changes

### New — `packages/report-engine` (currently a scaffold: README, package.json, tsconfig, empty src)

| File | Holds |
| --- | --- |
| `src/model.ts` | `ReportModel` and every section type. Zod schema, same discipline as the document: required-and-nullable, JSON-safe, strict. |
| `src/build.ts` | `buildReport({ document, catalog, ruleSet, generatedAt, appVersion })`. Pure. |
| `src/conclusion.ts` | The verdict decision, including `inconclusive`. Its own file because it is the one piece of judgement in the package. |
| `src/checklist.ts` | Findings + data gaps → checklist items |
| `src/bom.ts` | Placements → grouped equipment list with catalogue versions |
| `src/layout.ts` | `ReportModel` → `PageBox[]`. Pagination, repeating table headers, page numbering. |
| `src/drawing.ts` | Level geometry → vector paths at a page scale |
| `src/paper.ts` | Page sizes, margins, the typographic scale. Data, so A4/A3 and portrait/landscape are a parameter. |
| `src/emit.ts` | `PageBox[]` → PDF bytes. The **only** file that imports a PDF library. |
| `src/index.ts` | Public surface |
| `fixtures/index.ts` | A fully-populated document *and* a deliberately inconclusive one |
| `src/*.test.ts` | ~9 suites; see H |

Dependencies: `@mfd/document-model`, `@mfd/object-library`, `@mfd/rule-engine`, `zod`, and
one PDF library.

### PDF library — recommendation

| Option | Verdict |
| --- | --- |
| **`pdf-lib`** | **Recommended.** Pure TypeScript, no native binary, works in browser and Node identically, embeds raster images, draws vector paths, MIT. Font embedding needs `@pdf-lib/fontkit` for anything beyond the standard 14. |
| `pdfkit` | Node-oriented, stream-based; browser use needs a shim. Better typography out of the box, worse fit for AD-3's "same code both sides". |
| `jsPDF` | Browser-first, weaker vector and font story. |
| Headless browser + HTML | Rejected — see B. |

The boundary is drawn so this is replaceable: only `emit.ts` imports it, and stages 1–2 are
tested without it.

> **Owner decision needed:** does the report need Korean text? If so, font embedding stops
> being optional — the standard 14 PDF fonts have no CJK glyphs, and this is the choice
> that is painful to retrofit (B-2 in OPEN_QUESTIONS).

### Modified

| File | Change |
| --- | --- |
| `apps/web/src/features/report/ReportButton.tsx` | **new** — generate and download |
| `apps/web/src/features/report/ReportPreview.tsx` | **new** — the model rendered as HTML, so an engineer sees what they are about to produce |
| `apps/web/src/app/TopBar.tsx` | A "Report" action beside Save |
| `apps/web/src/features/validation/useEvaluation.ts` | Evaluate **every** level, not just the active one — the report needs all of them |
| `apps/web/package.json` | Add `@mfd/report-engine` |
| `docs/architecture/REPORT_ENGINE_DESIGN.md` | This document, kept current |
| `docs/roadmap/MVP_PLAN.md` | Sprint 5 acceptance criteria |
| `docs/testing/PLAYWRIGHT_TEST_PLAN.md` | Report specs |
| `README.md` | v0.5 |

### One change with a consequence worth flagging

`useEvaluation` currently evaluates the active level. The report needs all of them, so
evaluation becomes per-project. At 50 machines a level that is ~6 ms per level — fine for a
report, **not** fine to run on every pointer move across a ten-storey project.

So: the editor keeps evaluating the active level for live feedback, and the report evaluates
all levels on demand. Two call sites, one `evaluate`. Worth stating because "just evaluate
everything" would quietly make dragging a machine cost sixty milliseconds.

---

## H. Test strategy

### Unit — the report model, with no PDF anywhere

| Suite | Asserts |
| --- | --- |
| `model.shape.test.ts` | **Exact** key set of `ReportModel` and every section, like `result.shape.test.ts`. A report is a published artefact; a field appearing in one build and not another is a report that contradicts its predecessor. |
| `build.test.ts` | Every section populated from a fixture document; JSON round-trip; same bytes twice |
| `conclusion.test.ts` | All four verdicts, including that an all-YELLOW-for-want-of-a-threshold report is `inconclusive` and **not** `review_required` |
| `checklist.test.ts` | One item per RED, per unresolved YELLOW, per uncalibrated level, per draft record in use; every item traceable |
| `bom.test.ts` | Grouping by model across levels; catalogue versions carried; a placement pointing at a missing record is surfaced, not dropped; **manufacturer dimensions and design footprint appear as separate values, and a record with no manufacturer dimensions leaves them empty rather than echoing the footprint** |
| `drawing.test.ts` | An 800 mm **design footprint** is 800 mm at the page scale — the print-side twin of the browser dimension test. Asserted against the footprint, never the manufacturer dimensions, because the drawing shows the area reserved. |
| `layout.test.ts` | A 200-row table paginates; headers repeat; nothing is silently truncated |
| `emit.test.ts` | Produces a parseable PDF with the expected page count. Deliberately shallow — asserting on PDF internals tests the library. |
| `provenance.test.ts` | Rule set version, catalogue versions and both contract versions present |

### Browser

| # | Scenario |
| --- | --- |
| R1 | The preview shows every section |
| R2 | With the shipped draft catalogue the verdict is **inconclusive**, and the report says why |
| R3 | A RED finding appears in the findings table, on the drawing, and in the checklist |
| R4 | Generating downloads a PDF whose first bytes are `%PDF` |
| R5 | A two-level project produces sections for both |
| R6 | An uncalibrated level is named as such in the conclusion |
| R7 | The BOM shows 585 × 620 × 1305 mm and 800 × 800 mm as distinct values for the AK98, and leaves the manufacturer column empty for the bed |

### The verification that matters most

**R2 and `conclusion.test.ts`.** The whole risk of this sprint is a report that looks
finished and says nothing true. A test that a page of "threshold unknown" produces
`inconclusive` — and that no arrangement of draft data can produce `acceptable` — is the
one that keeps the report honest. It will be verified by making it fail.

---

## I. What Sprint 5 does not do

| | Why |
| --- | --- |
| Server-side generation and signing | No backend in Version 1 (D, OPEN_QUESTIONS). The pure `buildReport` is what makes it a later addition rather than a rewrite. |
| DXF / DWG export | Specification "Future" list |
| Editable report templates | A configurable template needs someone to have wanted a second layout first |
| Report comparison between revisions | Wants stored reports, which wants a server |
| Photographs / site evidence | Not in §5.5 |

---

## J. Decisions needed before implementation

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | **Language** — English, Korean, or both? | Decide now. CJK means embedded fonts, and it is the one choice here that is painful to retrofit. |
| 2 | **Liability sentence** (B-3) | Yours to write. The report will carry it verbatim, on page one. |
| 3 | **Verdict when nothing is verified** | `inconclusive`, worded as "this review could not be completed", with the missing manual named. |
| 4 | **Is a standard checklist expected** beyond the derived one? | If yes, it goes in `standards/` as data — not compiled into the generator. |
| 5 | **Page size** — A4 or A3? | A4 portrait for the document, one A3 landscape sheet for the drawing if the layout warrants it. |
| 6 | **Does the drawing page need the plan underlay**, or the traced geometry alone? | Underlay on, dimmed. It is what makes the drawing recognisable to the hospital. |
| 7 | **`ReportModel` frozen like the evaluation contract?** | Yes — `reportVersion = 1` and a shape lock. A report is a published artefact. |

Items 1 and 2 are the only two that block starting. The rest can be defaults I state and
you correct.
