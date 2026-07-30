# Sprint 5 — Report

> The engineering report engine. Shipped as **v0.5**.
> Architecture: [../architecture/REPORT_ENGINE_DESIGN.md](../architecture/REPORT_ENGINE_DESIGN.md).
> Plan: [SPRINT_5_PLAN.md](SPRINT_5_PLAN.md).
>
> **For owner review.** Sprint 6 is not started.

## Verdict

**Complete.** Nine sections in the owner's order, fully bilingual, with three renderers behind
one interface. 493 unit tests and 77 browser specs pass; typecheck, lint and both CI workflows
are clean.

Two things are deliberately not done and are stated here rather than left to be discovered: the
raster plan underlay is not drawn on the drawing page, and no DOCX renderer exists. Both are in
§ J of the architecture document with the reasoning.

---

## What the owner asked for, and what it cost

| Decision | What it meant |
| --- | --- |
| **Fully bilingual, findings included** | Reopened the frozen evaluation contract. `EVALUATION_RESULT_VERSION` is 2: findings carry `reasonCode` + `reasonParams`, and each language is composed from the code. |
| **Nine sections in a fixed order** | `SECTION_ORDER` is exported as data and asserted, so a renderer cannot reorder the document. Cover, datasheets and standards were new sections. |
| **PDF, DOCX, HTML, JSON without changing business logic** | The renderer boundary. The JSON renderer is three lines, which is the architecture's own test. |
| **Not a PDF export sprint** | The `ReportModel` is the deliverable. Every decision the report makes is in the model; renderers choose typography. |
| **Keep field-level verification; keep the footprint owner-defined** | Unchanged from Phase 4.5. The datasheet's three-block split is how the report expresses it. |
| **Browser CI reports PASS/FAIL and time only** | Done before Sprint 4 closed; the log is two lines and the diagnosis is one artifact download. |

### The bilingual decision was the expensive one, and it was right

The plan asked whether English-only finding prose was acceptable for this sprint, recommending
yes, because the alternative reopens a frozen contract. The owner said no.

That cost a contract version and a day. What it bought is a report where the Korean is not a
translation of anything: `renderReason('ko', …)` and `renderReason('en', …)` read the same
catalogue entry, so neither can drift behind the other. The English sentence on a finding is now
*derived* from its code, and a shape-lock test asserts exactly that.

The alternative would have shipped a report with bilingual headings over English findings, and
the Korean would have arrived in Sprint 6 as a translation layer over prose — which is the thing
that cannot be made to work. One early attempt is preserved as a warning in the code comments:
interpolating the English word "front" into a Korean template produced `{label}의 front 정비 공간`.

---

## Delivered

### Reason codes — `packages/rule-engine`

| | |
| --- | --- |
| `messages.ts` | 16 codes with bilingual title and template, plus a `kind`: violation, pass, unevaluable, caveat |
| `EvaluationResult` | `reasonCode`, `reasonParams`, `caveatCode`; `reason` retained but **derived** |
| Rule records | `name` and `description` are `{ko, en}` in `standards/rules/dialysis/` — a rule's name is part of the rule |
| The calibration gate | Sets `caveatCode: 'RC-911'` instead of concatenating a clause onto English prose |

A parameter carries its kind, which is the part that is easy to get wrong: a number is formatted
for the locale, a name the engineer chose is printed verbatim in both languages, and a word *we*
chose travels as `{ko, en}`. A station named 투석기 4 stays 투석기 4 in the English report,
because that is a name and not a phrase.

### The report model — `packages/report-engine`

| File | Holds |
| --- | --- |
| `model.ts` | `ReportModel`, `SECTION_ORDER`, `reportVersion = 1` |
| `labels.ts` | Every label the report prints, in both languages — one reviewable file |
| `notice.ts` | The liability statement, frozen, plus our own caveats kept separate from it |
| `conclusion.ts` | The four verdicts and their grounds |
| `equipment.ts` | Schedule rows and the three-block datasheet |
| `floorPlan.ts` | Drawing, calibration, mapping, numbered placements, vector geometry |
| `validation.ts` | Findings with threshold, source and verification |
| `checklist.ts` | Template items plus items derived from findings and data gaps |
| `standards.ts` | Every rule in the set, including those that produced nothing |
| `build.ts` | `buildReport` — pure, every level, no clock |
| `render/{json,html,pdf}.ts` | Three renderers behind one interface |
| `standards/checklists/dialysis.json` | The owner's six categories, as data |

### The editor

A Report action, a bilingual preview that is the same renderer as the HTML file, and PDF / HTML /
JSON downloads. Plus a project-details panel, because the cover page needed one — see below.

---

## Defects and gaps found while building it

Nine, and the tests that found them are noted because each one was invisible to review.

| # | Defect | How it surfaced |
| --- | --- | --- |
| 1 | **Nothing could set the cover page.** `customer` and `reviewedBy` have been in the schema since Sprint 4, so a hospital name was always *storable* — but no interface could type one, which would have meant a blank cover on every real report. | Writing the cover section |
| 2 | **pdf-lib was in the main bundle**, taking it from 679 kB to 1,878 kB — every user paying 1.2 MB for a PDF library on first paint. The package index re-exported the renderer, so no dynamic import could split it. | The bundler said so: *"dynamically imported … but also statically imported"* |
| 3 | **The report warned that the default project was uncalibrated.** A level with no drawing is not uncalibrated — its geometry is exact — and collapsing the two states is how a reader learns to ignore the warning that matters. | Browser spec R6, written expecting the warning |
| 4 | **The schedule printed 1,305 mm where the datasheet printed 1305 mm** — the same figure two ways in one document. | Browser spec R7 |
| 5 | **A derived checklist item whose category the template lacks was silently dropped.** A three-category template lost two of six data-gap items: "obtain the drain specification" vanishing because a site's template has no Drain heading. | A fixture template with three categories |
| 6 | **The fixture claimed a RED it could not produce** — no boundary rule in the default set — so every test about severity, derived items and the `not_acceptable` verdict was asserting on a report with nothing wrong in it. | Probing the fixture's actual output |
| 7 | **`☐` is not in the font.** The checklist checkbox was U+2610 BALLOT BOX; Pretendard has no glyph for it. | The missing-glyph guard, on the first render |
| 8 | **The verdict needed the finding's kind, not a hand-kept code list.** A YELLOW that is a pass downgraded for provenance is not a YELLOW that is a violation, and calling both "review required" tells a reader the drawing has concerns when the data is the problem. | Writing `conclusion.test.ts` |
| 9 | **`validation.spec.ts` asserted "threshold unknown"** — the English prose reason codes replaced. | The full browser suite |

Defect 7 is the one worth dwelling on: the guard that refuses to draw a missing glyph caught its
first real case unprompted, in my own code, on the first render. That is the whole argument for
it over a fallback.

---

## Tests verified to fail

| Check | Broken by | Result |
| --- | --- | --- |
| A Korean template that is actually Korean | Leaving an English sentence in a `ko` slot | Failed ✅ |
| Placeholder parity between languages | Adding `{other}` to only the Korean template | Failed ✅ |
| The palette states all six field groups | Rendering five | Failed ✅ (Phase 4.5) |
| Browser CI reports FAIL | A deliberately failing spec | Printed FAIL, exit 1 ✅ |
| The missing-glyph refusal | U+2610, unintentionally | Threw, naming the character ✅ |

Two assertions are strong enough that they are worth naming rather than listing:

**No arrangement of draft data reaches `acceptable`.** `conclusion.test.ts` asserts it over
*every code in the catalogue* rather than a chosen few — a YELLOW can never produce a pass, and a
RED always produces `not_acceptable`. That is the assertion the sprint's value rests on.

**Hangul survives into the PDF's text layer.** `FontFile2` and `ToUnicode` being present only
prove that a font was embedded. Extraction proves the glyphs are *mapped* — a report can carry a
perfect font and still draw the wrong characters, and it would look right to everything except a
reader. Asserted at the unit level with pdfjs and again through the browser in R11.

---

## Quality gates

| Gate | Result |
| --- | --- |
| Unit tests | **493** (was 402) |
| Browser specs | **77** (was 65) |
| Typecheck | Clean — strict, six packages |
| Lint | Clean |
| Production build | Clean. Main bundle 731 kB; pdf-lib a 1,147 kB on-demand chunk; 5.4 MB of fonts as separate assets |
| CI | ✅ |
| Browser CI | ✅ |

New tests by area:

| Area | Unit | Browser |
| --- | --- | --- |
| Reason codes and the bilingual catalogue | 12 | — |
| Report model and section builders | 28 | — |
| The verdict | 10 | — |
| Labels and field groups | 8 | — |
| The datasheet's three blocks | 8 | — |
| The checklist | 13 | — |
| Renderers, including PDF text extraction | 18 | 12 |
| **Total** | **97** | **12** |

---

## Carried forward

| # | Item |
| --- | --- |
| 1 | **A-1 — the AK98 installation data package.** Still the only thing between this and a usable answer. Sprint 5 made the consequence unmissable rather than hiding it: the verdict is 판정 불가 / Inconclusive and the summary counts the missing citations. |
| 2 | **A-3 — one real hospital drawing.** |
| 3 | The raster plan underlay on the drawing page. The model carries it; nothing draws it. |
| 4 | A DOCX renderer. The interface is in place; no file implements it. |
| 5 | A signature block with ruled fields to sign. The engineer's name is on the cover. |
| 6 | The editor's own interface is English. The *report* is bilingual, which is what the decision covered. |

## State handed over

| | |
| --- | --- |
| Branch | `claude/mfd-enterprise-structure-d7gmoq` |
| Document contract | `DOCUMENT_VERSION = 2` |
| Evaluation contract | `EVALUATION_RESULT_VERSION = 2` — reason codes, shape-locked |
| Report contract | `reportVersion = 1` — `SECTION_ORDER` as data |
| Packages | `cad-engine`, `object-library`, `rule-engine`, `document-model`, `report-engine` |
| Data | `standards/rules/dialysis/` (three files, bilingual, all `draft`), `standards/checklists/dialysis.json` |
| Fonts | Pretendard Regular + Bold, OFL 1.1, `packages/report-engine/assets/fonts/` |
