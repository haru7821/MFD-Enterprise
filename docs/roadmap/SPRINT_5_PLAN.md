# Sprint 5 — Implementation Plan

> **Not started. Implementation waits on approval of
> [REPORT_ENGINE_DESIGN.md](../architecture/REPORT_ENGINE_DESIGN.md).**
> This document is the *how* and the *order*; that document is the *what* and the *why*.
> Scope: TS Edition specification §5.5 — PDF Installation Review Report.

---

## What is settled, and what is not

| | |
| --- | --- |
| **Settled** | Report language: bilingual Korean + English. Liability notice: verbatim, both languages, last. Sprint 4: closed. |
| **Awaiting review** | The architecture itself — the four-stage pipeline, the `ReportModel` shape, `pdf-lib`, and the decisions listed as still-open in § K of the design. |
| **Not blocking** | Items 3–9 of that table. I have stated defaults and will implement them unless corrected. |
| **Blocking nothing here, blocking the product** | The AK98 manual. Sprint 5 can be finished and correct while every clearance finding still reads "threshold unknown". |

**One question I would like answered before starting**, because it changes what Sprint 5
promises rather than how it looks: decision 8 — is English-only finding prose acceptable for
this sprint, with bilingual reason codes scheduled for Sprint 6? Everything else I can default.

---

## Order of work

Six steps. Each ends at a state where the suite is green and the work so far is useful — no
step leaves the repository in a half-migrated condition.

### Step 1 — The model, and nothing that draws (≈2 days)

| Files | |
| --- | --- |
| `packages/report-engine/src/model.ts` | `ReportModel` and every section type, as a Zod schema. Same discipline as the document model: strict objects, required-and-nullable, JSON-safe. |
| `src/labels.ts` | Every printable label, Korean and English |
| `src/notice.ts` | The liability statement, frozen |
| `src/model.shape.test.ts` | Exact key set, section by section |
| `src/labels.shape.test.ts` | Every key has both languages; the key set is locked |
| `src/notice.test.ts` | Both strings character for character |

**Why first.** `reportVersion = 1` is a published contract. Getting the shape wrong is the one
mistake here that is expensive later, and it is decidable with no PDF library present.

**Done when** the shape lock passes and a hand-written `ReportModel` literal validates.

### Step 2 — Build: document + catalogue + rules → model (≈3 days)

| Files | |
| --- | --- |
| `src/build.ts` | `buildReport({ document, catalog, ruleSet, generatedAt, appVersion })` — pure |
| `src/conclusion.ts` | The four verdicts, including `inconclusive` |
| `src/checklist.ts` | Findings and data gaps → items |
| `src/bom.ts` | Placements → grouped equipment list, both size columns, per-group verification blocks |
| `fixtures/index.ts` | A fully-populated document **and** a deliberately inconclusive one |
| Five test suites | `build`, `conclusion`, `checklist`, `bom`, `verification` |

**The load-bearing step.** Everything the report *claims* is decided here, and all of it is
assertable without parsing a PDF.

**Done when** every section is populated from both fixtures, the same input produces identical
JSON twice, and `conclusion.test.ts` proves a page of "threshold unknown" is `inconclusive`
rather than `review_required` — **verified by making it fail**.

**Also in this step:** `useEvaluation` splits into per-level (live) and per-project (report).
Small, and it belongs with the code that needs it.

### Step 3 — Layout: model → pages (≈3 days)

| Files | |
| --- | --- |
| `src/paper.ts` | Page sizes, margins, the type scale. Data, so A4/A3 and portrait/landscape are parameters. |
| `src/layout.ts` | `ReportModel` → `PageBox[]`. Pagination, repeating headers, page numbers, the notice's reserved space. |
| `src/layout.test.ts` | A 200-row table paginates; headers repeat; a bilingual header is not clipped; the notice is on the last page of every fixture |

Still no PDF library. `PageBox[]` is data, so pagination is unit-testable — which is the point
of separating it from emit.

**The bilingual consequence lands here.** A `한국어 / English` header is roughly 1.7× the width
of English alone, which is why the placement and BOM tables are landscape. Text measurement
needs the real font metrics, so `fonts.ts` arrives with this step rather than the next.

### Step 4 — Emit: pages → PDF, with Korean in it (≈3 days)

| Files | |
| --- | --- |
| `src/fonts.ts` | Loading and subsetting. **Takes font bytes as an argument** — the package never touches a filesystem, so it stays runnable in a browser and on a server. |
| `assets/fonts/` | Noto Sans KR Regular + Bold, `OFL.txt` alongside |
| `src/emit.ts` | The only file that imports `pdf-lib` |
| `src/fonts.test.ts`, `src/emit.test.ts` | Glyph coverage and a parseable PDF |

**The risk concentrates here**, so it is scheduled with room around it. Embedding a CJK face,
subsetting it, and measuring bilingual text are the three things in this sprint I have not done
in this codebase. A missing glyph **throws naming the character** rather than emitting a blank
box — a tofu square in a signed document is exactly the quiet failure this product refuses.

`emit.test.ts` stays deliberately shallow: page count and parseability. Asserting on PDF
internals tests `pdf-lib`, not us.

### Step 5 — The drawing page (≈2 days)

| Files | |
| --- | --- |
| `src/drawing.ts` | Level geometry → vector paths at page scale |
| `src/drawing.test.ts` | An 800 mm **design footprint** is 800 mm at page scale — the print-side twin of the browser dimension test |

Vector, from millimetres, never a canvas screenshot (AD-2). Findings numbered on the drawing to
match the finding table's rows, because a reader who has to do that join by eye has been handed
a decorative report.

### Step 6 — The editor: preview, generate, download (≈2 days)

| Files | |
| --- | --- |
| `apps/web/src/features/report/ReportPreview.tsx` | The model as HTML, so an engineer sees what they are about to send |
| `apps/web/src/features/report/ReportButton.tsx` | Generate and download; the fonts arrive by dynamic import here |
| `apps/web/src/app/TopBar.tsx` | A "Report" action beside Save |
| `tests/e2e/report.spec.ts` | R1–R11 from the design |

**Preview before download, deliberately.** A twelve-page PDF that has to be opened to be
checked is a twelve-page PDF nobody checks.

---

## Estimate

| Step | Days |
| --- | --- |
| 1 · Model, labels, notice | 2 |
| 2 · Build, conclusion, checklist, BOM | 3 |
| 3 · Layout and pagination | 3 |
| 4 · Fonts and emit | 3 |
| 5 · Drawing page | 2 |
| 6 · Editor integration | 2 |
| **Total** | **15 working days** ≈ 3 weeks at one developer |

Step 4 is the one I would expect to slip. If it does, steps 1–3 and 5 still leave a complete,
tested, bilingual report model with a rendered HTML preview — a shippable increment that only
lacks the PDF, which is a better failure shape than a PDF that renders wrong text.

---

## Test budget

| | Added |
| --- | --- |
| Unit suites | ~11 (`model.shape`, `labels.shape`, `notice`, `build`, `conclusion`, `checklist`, `bom`, `verification`, `layout`, `fonts`, `drawing`, `emit`, `provenance`) |
| Unit tests | ~90 |
| Browser specs | 11 (R1–R11) |

Three will be verified by making them fail, chosen because each guards a claim rather than a
mechanism:

| Check | How it will be broken |
| --- | --- |
| A page of "threshold unknown" is `inconclusive`, never `acceptable` | Force the verdict to `acceptable` and confirm the suite reddens |
| The liability notice is on the last page of every fixture | Drop it from one fixture's layout |
| Hangul survives into the PDF text layer | Fall back to a Latin-only font and confirm R11 fails rather than silently emitting boxes |

The first is the sprint's whole risk in one assertion: a report that looks finished and says
nothing true.

---

## Risks

| Risk | Handling |
| --- | --- |
| **CJK font embedding is harder than expected** | Scheduled with room; steps 1–3 and 5 are independent of it, and the HTML preview is a working deliverable without it. |
| **Font assets bloat the bundle** | ~10 MB of faces behind a dynamic import, the same treatment the pdf.js worker already has. A build-size check belongs in this sprint's CI step. |
| **Bilingual headers overflow the page** | Landscape for the wide tables, and `layout.test.ts` asserts no clipping rather than trusting the measurement. |
| **The report reads as authoritative while every input is draft** | The `inconclusive` verdict, per-finding provisional marks, the verified/draft split in the equipment sheet, and the notice. This is the risk the sprint exists to manage, not a side concern. |
| **Scope drift into templating** | Editable templates, DOCX and report diffing are all explicitly out (§ J of the design). A second layout gets designed when somebody has wanted one. |
| **The rasterised underlay makes large PDFs** | Unavoidable while the underlay is raster by design (C-6). Stated in the design rather than discovered by a user. |

---

## Not in Sprint 5

Server-side generation and signing · DXF/DWG · editable templates · report comparison between
revisions · photographs and site evidence · **bilingual finding prose** (decision 8).

---

## Definition of done

1. A TS engineer clicks Report, sees a preview with every section in Korean and English, and
   downloads a PDF.
2. Every figure in it is traceable: rule, threshold origin, document, revision, section.
3. Nothing in it claims more than the data supports — `inconclusive` when the manual is
   missing, provisional marks per finding, verified and draft separated in the equipment sheet.
4. The liability notice is on the last page, in both languages, verbatim, on every report
   including an empty one.
5. Typecheck, lint, unit tests and both CI workflows green.
6. `MVP_PLAN.md`, `PLAYWRIGHT_TEST_PLAN.md` and `README.md` current at v0.5.

Point 3 is the one that decides whether this sprint was worth doing.
