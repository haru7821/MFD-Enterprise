# Sprint 5 — Report Engine Architecture

> **Approved and implemented.** Kept as the architecture of record; the sections that
> changed during implementation say so inline.
> Scope: TS Edition specification §5.5, and the owner's nine-section structure.
> State: `DOCUMENT_VERSION = 2`, `EVALUATION_RESULT_VERSION = 2`, `reportVersion = 1`.
>
> **What the owner changed after review**, and what it cost:
>
> | Decision | Consequence |
> | --- | --- |
> | Fully bilingual findings, not English-only | `EVALUATION_RESULT_VERSION` 2 — findings carry reason codes |
> | Nine sections in a fixed order | `SECTION_ORDER` is data; cover, datasheets and standards were new |
> | PDF, DOCX, HTML, JSON without changing business logic | The renderer boundary; JSON is three lines |
> | Not a PDF export sprint — an engineering report engine | The model, not the PDF, is the deliverable |

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

> **Revised at implementation.** The owner specified nine sections in a fixed order; the
> pre-review draft grouped drawing, calibration, mapping and findings under a single
> `LevelSection`. The owner's order governs, and it is better: an engineer reads the schedule
> before the floor plans, and the datasheets after the findings that reference them.

```ts
interface ReportModel {
  readonly reportVersion: number;              // 1, frozen like the evaluation contract
  readonly generatedAt: string;                // ISO, injected — never a clock

  readonly cover: CoverSection;                // 1
  readonly summary: ExecutiveSummarySection;   // 2 — the verdict, on page one
  readonly equipmentSchedule: EquipmentScheduleSection; // 3
  readonly floorPlans: readonly FloorPlanSection[];     // 4 — one per level
  readonly validation: readonly ValidationSection[];    // 5 — one per level
  readonly checklist: ChecklistSection;        // 6
  readonly datasheets: readonly DatasheetSection[];     // 7
  readonly standards: StandardsSection;        // 8
  readonly notice: NoticeSection;              // 9 — the liability statement, last
  readonly provenance: ProvenanceSection;      // contract versions, after the notice
}
```

`SECTION_ORDER` is exported **as data** and asserted by a test, so a renderer cannot reorder
the document and an added section has to be placed deliberately.

### Section by section, against the owner's structure

| # | Owner asked for | Section | Source |
| --- | --- | --- | --- |
| 1 | Cover page: hospital, project, customer, TS engineer, date, MFD version | `cover` | `Project` + `Customer`. **Nothing could set these before Sprint 5** — see the note below. |
| 2 | Executive summary: total equipment, GREEN/YELLOW/RED | `summary` | Every level's `EvaluationReport`, plus the verdict and its grounds |
| 3 | Equipment schedule: id, manufacturer, model, manufacturer dimensions, design footprint, verification | `equipmentSchedule` | Catalogue records, grouped by model, counted across every level |
| 4 | Floor plan: drawing, equipment numbering, scale, coordinate reference | `floorPlans[]` | `PlanImage`, `ScaleCalibration`, `CoordinateMapping`, vector geometry in millimetres |
| 5 | Validation: severity, rule id, rule name, Korean, English, applied threshold, threshold source, verification | `validation[]` | `EvaluationReport` + the rule file's bilingual `name` |
| 6 | Installation checklist: electrical, RO water, drain, network, accessibility, final engineer check | `checklist` | `standards/checklists/dialysis.json` **plus** items derived from the findings |
| 7 | Datasheets: manufacturer data, design footprint, draft data as three separated sections | `datasheets[]` | Per-group `fieldVerification` — see the three-block rule below |
| 8 | Standards: every applied standard | `standards` | **Every** rule in the set, including those that produced nothing |
| 9 | Liability statement | `notice` | A frozen constant, both languages, verbatim |
| — | *Provenance* | `provenance` | Rule set, catalogue and all three contract versions |

**Where the verdict went.** The pre-review draft argued for a conclusion on page one and the
liability notice there too. The owner's structure puts the summary at 2 and the notice at 9,
which resolves it better than the draft did: page one carries the verdict, and the notice
does not compete with it.

**The cover page needed a feature, not a section.** `customer` and `reviewedBy` have been in
the schema since Sprint 4, so a hospital name was always storable — but nothing in the editor
could type one, which would have meant a blank cover on every real report. Sprint 5 added
`setProjectDetailsCommand` and a sidebar panel. Worth recording because it is the kind of gap
a section list does not reveal: the field existed, the path to it did not.

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

### The equipment data sheet: verified and draft, separated

> Owner decision, Phase 4.5: *"The report shall clearly distinguish verified and draft
> sections."* Verification is per field group, so the report cannot stamp a record
> `DRAFT` and be done — that is the record-level behaviour the owner replaced.

Each model in the BOM gets a data block **split in two**, and the split is by verification
status rather than by subject:

```
Vantive AK98 · catalogue record 0.3.0 · 12 units

VERIFIED — AK 98 Operator Manual, Rev 04, §15 Technical data
  Manufacturer dimensions   585 × 620 × 1305 mm
  Electrical                230 V, 1-phase, 10 A
  Environmental             18–30 °C, 15–75 % RH

DRAFT — no manual reference. Findings that read these figures are marked provisional.
  Service clearance         not supplied
  RO water                  not supplied
  Drain                     not supplied

PLANNING (owner decision, not a manufacturer figure)
  Design footprint          800 × 800 mm
  Basis                     —
```

Three blocks, not two, and the third is the point of the earlier split. The design footprint
is neither verified nor draft: it is an owner decision with no citation, and printing it
under a "DRAFT" heading would read as a figure someone has not got round to sourcing yet
rather than one that will never have a document behind it. Printing it under "VERIFIED"
would be worse.

The verified block **names its citation once per group**, because two groups can come from
different documents — a datasheet for the dimensions and the installation manual for the
clearances is the ordinary case, not an edge one.

A group whose values are all null prints "not supplied" rather than a row of dashes, so the
reader can tell "we know this and it is unlimited" from "we do not know this".

### Which findings the report marks provisional

Per-group verification changes what a draft record means for the findings table, and the
report must not overstate it:

| Finding | Marked provisional when |
| --- | --- |
| Clearance, threshold from the equipment record | That model's service clearance group is draft |
| Clearance, threshold from the rule | Never on equipment grounds — the number came from `standards/` |
| Equipment collision | Never on equipment grounds — footprints only |
| Boundary collision | Never on equipment grounds — footprint and traced geometry |
| Anything, on an uncalibrated level | Always — the millimetres themselves are in question |

The engine reads `result.dataStatus` per finding rather than recomputing this, so the table
cannot disagree with the panel on screen. The rows above document *why* a given finding
carries the status it does, which is what an engineer asked "why is this one provisional and
that one not?" needs to be able to answer.

---

## D. Language: bilingual Korean and English

> **Owner decision.** Bilingual Korean + English throughout. Every section title and field
> label carries both languages.

This is the decision that reaches furthest into the implementation, so it is settled before
any of it is written rather than retrofitted. Three consequences: what is translated, how
the model carries it, and font embedding.

### What is bilingual, and what is not

The decision names **section titles and field labels**. Those are ours to write, they are
finite, and a Korean reviewer can check them once. Everything else divides as follows:

| Kind of text | Bilingual? | Why |
| --- | --- | --- |
| Section titles, field labels, table headers | **Yes** | The owner's decision. Ours to author, reviewable as a set. |
| Verdict names, statuses, checklist verbs | **Yes** | Same category — our words, and the ones a hospital reads first. |
| The liability notice | **Yes** | Supplied in both languages verbatim — see below. |
| Project name, room names, machine labels | **No** — printed as typed | An engineer who names a room 투석실 A gets 투석실 A. Translating a name someone chose is inventing data. |
| Manual document titles, revisions, sections | **No** — printed as cited | A citation must match the document a reader will pick up. "AK 98 Operator Manual" is the document's name, not a phrase. |
| Numbers, units, dates | **No** — one form | 800 mm is 800 mm. Printing it twice would be noise, and localising the decimal separator would make two figures out of one. |
| **Finding reasons** | **Not yet** — English only | See the honest note below. |

**The finding reasons are the gap, and I am flagging it rather than papering over it.**
Strings like "Station 4 overlaps Station 5 by 500 mm" are composed inside the rule
evaluators, in English, today. Making them bilingual is not a report-engine change: it means
findings carrying a **reason code plus parameters** instead of a sentence, so either language
can be composed at render time. That is a change to a frozen contract
(`EVALUATION_RESULT_VERSION` 1 → 2) and it belongs in its own sprint.

> **Owner decision: no.** English-only findings are not acceptable. Every finding, warning and
> recommendation carries both languages, with language-independent reason codes.
>
> So the contract was reopened in this sprint rather than deferred, and the table above changed
> with it: **finding sentences are bilingual**, composed per language from `reasonCode` +
> `reasonParams`. `EVALUATION_RESULT_VERSION` is 2. The full design is in
> [RULE_ENGINE_API.md](RULE_ENGINE_API.md#reason-codes--why-a-finding-is-not-a-sentence).
>
> The one thing that did **not** change is the refusal to translate by substituting words into
> an English sentence. That would put grammar in a renderer and break the moment a rule's
> wording changed; the first attempt at it produced "{label}의 front 정비 공간". Korean and
> English are separate templates keyed by the same code.

### How the model carries two languages

Labels are **keys in the model and prose in one catalogue**, not two strings duplicated into
every row:

```ts
/** Every label the report can print, in both languages. */
interface Bilingual {
  readonly ko: string;
  readonly en: string;
}

// src/labels.ts — the single place any wording lives.
export const LABELS = {
  section_project:        { ko: '프로젝트 정보',   en: 'Project Information' },
  field_manufacturer_dim: { ko: '제조사 치수',     en: 'Manufacturer Dimensions' },
  field_design_footprint: { ko: '설계 점유 면적',  en: 'Design Footprint' },
  status_verified:        { ko: '검증됨',         en: 'Verified' },
  status_draft:           { ko: '미검증',         en: 'Draft' },
  // …
} as const satisfies Record<string, Bilingual>;

type LabelKey = keyof typeof LABELS;
```

Three reasons for keys rather than inlined prose:

1. **A model fixture asserts data, not wording.** If every row carried both strings, editing
   a Korean label would fail thirty tests that are about numbers.
2. **One file to review.** A Korean-speaking reviewer reads `labels.ts` once, not the
   generator.
3. **A missing translation cannot ship.** `satisfies Record<string, Bilingual>` makes a
   half-translated entry a compile error, and a shape-lock test pins the key set the same way
   `result.shape.test.ts` pins the evaluation contract.

`LABELS` lives in the package, **not** in `standards/`. AD-4 makes `standards/` the source of
record for *engineering rules*; a column heading is not one, and putting wording there would
blur what that directory means.

### How a bilingual label is set

| Element | Form | Why |
| --- | --- | --- |
| Section title | Two lines: Korean above, English beneath in a smaller size | A title has vertical room, and stacking keeps both readable |
| Field label, table header | One line: `한국어 / English` | A two-line header doubles the height of every table on the page |
| Values | Once | See above |

**Korean first.** The report is handed to a Korean hospital, so the primary reader's language
leads. Easily revisable — it is one ordering constant in `labels.ts`, not a layout rewrite.

Bilingual headers cost roughly 1.7× the width of English alone, which is a layout fact rather
than a nuisance: the placement and BOM tables are specified at A4 **landscape** for this
reason, and `layout.test.ts` asserts that no header is clipped rather than trusting it.

### Fonts: embedding is now mandatory

The standard 14 PDF fonts have no Hangul glyphs. A CJK report **must** embed a font, which is
the retrofit-painful choice the earlier draft flagged, and it is now settled.

| Decision | Value | Notes |
| --- | --- | --- |
| Family | **Pretendard**, Regular + Bold | SIL Open Font License 1.1. Substituted for Noto Sans KR at implementation: reachable through the package registry this environment can use, and 5.4 MB for both faces against Noto's ~11 MB for the same coverage. Verified to carry all 11,172 Hangul syllables plus ×, ·, ≥, °, ㎡. `assets/fonts/OFL.txt` ships alongside. |
| Coverage | One family for **both** scripts | Noto Sans KR carries Latin, so a bilingual line is one font. Mixing Helvetica with a Korean face would mismatch on the same line and complicate width measurement. |
| Subsetting | **On**, via `@pdf-lib/fontkit` | A report uses a few hundred distinct glyphs. Subsetting puts tens of kilobytes in the PDF instead of megabytes. |
| Loading | **Dynamic import**, like the existing pdf.js worker chunk | The two faces are ~10 MB of assets. They must not sit in the initial bundle for a user who never generates a report. |
| Fallback | **None. Fail loudly** | A missing glyph renders as a blank box, and a report with blank boxes where a room name should be is worse than an error. `emit.ts` throws naming the character it could not draw. |

The last row is the one worth arguing about, so: a silent tofu box in a signed document is
exactly the class of quiet failure this product is built to refuse. An error the engineer sees
before sending it is cheaper than a hospital reading 투□실.

---

## E. The conclusion, and what it says when nothing is verified

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

## F. The installation checklist

The specification asks for one. It is not clear it should be a fixed list, and a fixed list
is the wrong answer here: a checklist of generic items ("verify power supply") that ignores
what the drawing actually shows is a form, not an engineering output.

**Proposed: derive it from the findings, and mark what could not be checked.**

| Checklist item | Comes from |
| --- | --- |
| One item per RED finding | "Resolve: Station 12 overlaps Column C4 by 150 mm" |
| One item per unresolved YELLOW | "Confirm on site: front clearance for Station 4 — no manual figure available" |
| One item per uncalibrated level | "Calibrate the 4F drawing before relying on any measurement from it" |
| One item per **draft field group** on a record in use | "Obtain the service clearance figures for Vantive AK98 from the installation manual" — one item per group, not one per record, so a record with five groups sourced does not read as wholly unverified |
| Fixed items from the rule set | Only if the rule data declares them — never hard-coded here |

Every item is traceable to a finding or a data gap, so the checklist cannot drift out of
step with the assessment. And an engineer who works through it has, by construction, worked
through everything the tool could not conclude.

> **Owner decision needed:** whether the hospital also expects a *standard* checklist
> independent of the drawing (commissioning steps, handover items). If so it belongs in
> `standards/`, as data, alongside the rules — not in the report generator.

---

## G. The layout drawing

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

## G-2. The signature block and the liability notice

### Signature block

| Field | Filled by |
| --- | --- |
| Reviewed by · 검토자 | `project.reviewedBy` if set, otherwise blank to sign |
| Date · 일자 | Blank — the date signed is not the date generated |
| Organisation · 소속 | Blank |
| Signature · 서명 | Blank, ruled |

`generatedAt` appears in the provenance section, not here. They are different facts, and
printing the generation timestamp on the signature line would let an unsigned report look
signed.

### Liability notice — verbatim, both languages, last

> **Owner decision.** The following notice appears at the end of every report.

**English**

> This report is generated to support engineering planning and installation review. Final
> installation approval shall be based on applicable regulations, manufacturer documentation,
> and site verification.

**Korean**

> 본 보고서는 설치 계획 및 기술 검토를 지원하기 위한 자료입니다. 최종 설치 승인 및 시공은
> 관련 법규, 제조사 공식 문서 및 현장 실측 결과를 기준으로 수행되어야 합니다.

Implementation, and the reasons each part is not a matter of taste:

| Rule | Why |
| --- | --- |
| A **frozen constant** in `src/notice.ts`, not a template and not configurable | This is legal wording. A generator that can interpolate into it is a generator that can alter it. |
| `notice.test.ts` asserts both strings **character for character** | The failure mode is a well-meant edit — a comma, a softened "shall". The test makes the wording immutable in practice, not just in intent. |
| Emitted **last**, and `layout.ts` reserves its space before paginating | Reserved rather than appended, so it can never be the thing that falls off the end of a full page. |
| `layout.test.ts` asserts it is present on the final page of **every** fixture, including the empty project | A notice that appears on most reports is not a notice. |
| Both languages always, regardless of any future language setting | It was supplied as a pair. Printing one half would be an edit. |

The notice also carries the one honest caveat this report needs while the finding prose is
English-only (see D): a line stating that the findings' explanatory text is in English. That
sentence is **ours**, marked as such, and kept clearly separate from the owner-supplied
wording above — which is not edited, extended, or wrapped.

---

## H. Package and file changes

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
| `src/labels.ts` | Every printable label in Korean and English. The one file wording lives in. |
| `src/notice.ts` | The liability notice, frozen, both languages |
| `src/fonts.ts` | Font loading and subsetting. Takes the font bytes as an argument — the package never reads a file, so it stays runnable in a browser and on a server. |
| `assets/fonts/` | Noto Sans KR Regular + Bold, with `OFL.txt` alongside |
| `src/index.ts` | Public surface |
| `fixtures/index.ts` | A fully-populated document *and* a deliberately inconclusive one |
| `src/*.test.ts` | ~9 suites; see I |

Dependencies: `@mfd/document-model`, `@mfd/object-library`, `@mfd/rule-engine`, `zod`, and
one PDF library.

### PDF library — recommendation

| Option | Verdict |
| --- | --- |
| **`pdf-lib`** | **Recommended.** Pure TypeScript, no native binary, works in browser and Node identically, embeds raster images, draws vector paths, MIT. Bilingual output makes `@pdf-lib/fontkit` a requirement rather than an option — it is what subsets an embedded Korean face. |
| `pdfkit` | Node-oriented, stream-based; browser use needs a shim. Better typography out of the box, worse fit for AD-3's "same code both sides". |
| `jsPDF` | Browser-first, weaker vector and font story. |
| Headless browser + HTML | Rejected — see B. |

The boundary is drawn so this is replaceable: only `emit.ts` imports it, and stages 1–2 are
tested without it.

**Settled:** the report is bilingual, so font embedding is mandatory and `fontkit` is in.
Details in D. This was the retrofit-painful choice, and it is now made before any of the
emit stage exists — which is the whole reason for asking early.

### Modified

| File | Change |
| --- | --- |
| `apps/web/src/features/report/ReportButton.tsx` | **new** — generate and download |
| `apps/web/src/features/report/ReportPreview.tsx` | **new** — the model rendered as HTML, so an engineer sees what they are about to produce |
| `apps/web/src/app/TopBar.tsx` | A "Report" action beside Save |
| `apps/web/src/features/validation/useEvaluation.ts` | Evaluate **every** level, not just the active one — the report needs all of them |
| `apps/web/package.json` | Add `@mfd/report-engine`; the font assets load through a dynamic import so they stay out of the initial chunk |
| `apps/web/vite.config.ts` | Font assets as separate chunks, the same treatment the pdf.js worker already gets |
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

## I. Test strategy

### Unit — the report model, with no PDF anywhere

| Suite | Asserts |
| --- | --- |
| `model.shape.test.ts` | **Exact** key set of `ReportModel` and every section, like `result.shape.test.ts`. A report is a published artefact; a field appearing in one build and not another is a report that contradicts its predecessor. |
| `build.test.ts` | Every section populated from a fixture document; JSON round-trip; same bytes twice |
| `conclusion.test.ts` | All four verdicts, including that an all-YELLOW-for-want-of-a-threshold report is `inconclusive` and **not** `review_required` |
| `checklist.test.ts` | One item per RED, per unresolved YELLOW, per uncalibrated level, per **draft field group** on a record in use; every item traceable |
| `bom.test.ts` | Grouping by model across levels; catalogue versions carried; a placement pointing at a missing record is surfaced, not dropped; **manufacturer dimensions and design footprint appear as separate values, and a record with no manufacturer dimensions leaves them empty rather than echoing the footprint** |
| `verification.test.ts` | A record with **some** groups verified splits into a verified block and a draft block, each listing only its own groups, each verified group carrying its own citation; the design footprint appears in neither and is printed as a planning decision; a fully verified record emits no draft block at all rather than an empty heading |
| `labels.shape.test.ts` | Every key carries a non-empty `ko` **and** `en`; the key set is locked; no label key referenced by the layout is missing. A half-translated label must not reach a PDF. |
| `notice.test.ts` | Both liability strings asserted character for character against the owner's wording, and that `notice` is the last section of the model |
| `drawing.test.ts` | An 800 mm **design footprint** is 800 mm at the page scale — the print-side twin of the browser dimension test. Asserted against the footprint, never the manufacturer dimensions, because the drawing shows the area reserved. |
| `layout.test.ts` | A 200-row table paginates; headers repeat; nothing is silently truncated; **a bilingual header is not clipped at the specified page width**; the notice is on the last page of every fixture |
| `fonts.test.ts` | Hangul, Latin and the mm sign all resolve in the embedded face; a character with no glyph **throws** naming the character rather than emitting a blank box |
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
| R8 | The datasheet keeps its three blocks apart, and the design footprint is labelled a planning decision rather than draft data |
| R9 | Every section title in the preview shows both Korean and English |
| R10 | The liability notice appears, in both languages, at the end — including on a report with no equipment placed |
| R11 | Hangul survives into the generated PDF's text layer, which is what proves the embedded font is being **used** rather than silently dropping glyphs. Implemented by downloading the PDF and parsing it with pdf.js in Node. |
| — | A character the font cannot draw produces a **visible error in the interface**, not a blank box in the file |

All twelve pass. R8 as originally written wanted a record with one group cited, which would
have meant shipping a citation the owner has not supplied; it is asserted at the unit level
instead (`equipment.test.ts`), and the browser spec checks the block structure.

### The verification that mattered most

**R2 and `conclusion.test.ts`.** The whole risk of this sprint is a report that looks finished
and says nothing true. `conclusion.test.ts` asserts, over **every code in the catalogue**
rather than a chosen few, that a YELLOW can never produce `acceptable` and a RED always
produces `not_acceptable`. R2 asserts the same thing through the browser on an empty project.

**R11 and `render.test.ts`.** `FontFile2` and `ToUnicode` being present only prove that a font
was embedded. Extraction proves the glyphs are **mapped** — a report can carry a perfect font
and still draw the wrong characters, and it would look right to everything except a reader.

**The missing-glyph refusal, verified by accident on the first render.** The checklist checkbox
was U+2610 BALLOT BOX and Pretendard has no glyph for it, so the guard threw and named the
character. That is exactly the failure it exists to catch, arriving unprompted. The checkbox is
now a drawn vector square.

---

## J. What Sprint 5 did not do

| | Why |
| --- | --- |
| **DOCX** | The interface is in place and the JSON renderer proves the boundary holds — a DOCX file would satisfy `TextRenderer`/`BinaryRenderer` without touching `build.ts`. Not stubbed: a `renderDocx` that threw would be a promise the package appears to keep. |
| **The raster plan underlay on the drawing page** | The model carries `drawing.dataUrl`; the renderers draw vector geometry only. Embedding a 3000 × 2000 scan is the one place the output stops being vector, and it wants a decision about file size (C-6) rather than a quiet addition. Recorded rather than left to be discovered. |
| **A signature block with ruled fields** | The engineer's name is on the cover; blank ruled lines to sign are not yet drawn. |
| Server-side generation and signing | No backend in Version 1. The pure `buildReport` is what makes it a later addition rather than a rewrite. |
| DXF / DWG export | Specification "Future" list |
| Editable report templates | A configurable template needs someone to have wanted a second layout first |
| Report comparison between revisions | Wants stored reports, which wants a server. The JSON renderer is what such a comparison would diff. |
| Photographs / site evidence | Not in §5.5 |

---

## K. Decisions

### Settled by the owner

| # | Question | Decision |
| --- | --- | --- |
| 1 | **Language** | **Bilingual Korean + English throughout**, every section title and field label in both. Font embedding is therefore mandatory — see D. |
| 2 | **Liability statement** | Supplied verbatim in both languages. Carried at the **end** of every report, frozen, character-asserted — see G-2. |

Note one adjustment to my own earlier proposal: I had assumed the liability sentence would sit
on page one. The decision places it at the end, which is what is implemented — and it is the
better placement, since page one is the conclusion and a notice above the verdict competes
with it.

### Settled during implementation

| # | Question | What was built |
| --- | --- | --- |
| 3 | **Verdict when nothing is verified** | `inconclusive` / 판정 불가, with its grounds counted. Sharpened once: a YELLOW that is a *pass downgraded for provenance* also counts as inconclusive, because the drawing is not the problem — the data is. `ReasonKind` in the rule engine carries that distinction so it is not a hand-kept list. |
| 4 | **Is a standard checklist expected** beyond the derived one? | **Yes, both.** `standards/checklists/dialysis.json` holds the owner's six categories as data; derived items from findings and per-group data gaps go in the same categories, derived first. A checklist of only derived items is empty on a drawing with no equipment, and a water loop still needs commissioning. |
| 5 | **Page size** | A4 **landscape** throughout. Bilingual headers are ~1.7× the width of English and the wide tables carry eight columns; portrait clipped them. A3 is a parameter in `paper.ts`. |
| 6 | **Does the drawing page need the plan underlay?** | Vector geometry only, so far. The raster underlay is carried in the model (`drawing.dataUrl`) and not yet drawn — see "what Sprint 5 did not do". |
| 7 | **`ReportModel` frozen like the evaluation contract?** | Yes — `reportVersion = 1`, `SECTION_ORDER` as data, and a build test over both. |
| 8 | **English-only finding prose?** | **No** — owner decision. Reopened `EVALUATION_RESULT_VERSION` in this sprint. See D. |
| 9 | **Korean above English, or the reverse?** | Korean first, as recommended. One constant (`DEFAULT_RENDER_OPTIONS`), and every renderer takes the pair as a parameter rather than hard-coding an order. |
