# MFD-Hospital-Dataset — Engineering Audit

| | |
| --- | --- |
| **Dataset** | `haru7821/MFD-Hospital-Dataset` |
| **Commit audited** | `6f665d4e04a756bbb41434d499fe81b428285157` |
| **Declared version** | `hospital-layout-dataset` 1.0.0, generated 2026-07-31 |
| **Audit scope** | Whole repository, read-only. **No file in the dataset was modified.** |
| **Method** | Every figure below was computed from the files. Nothing is estimated. Where a fact could not be established it is marked **UNKNOWN**. |

> **Read this first.** This dataset contains **architectural floor plans**. It holds no patient,
> doctor, visit, diagnosis, medication or billing data of any kind — see §4 and §6, where the
> absence is the finding rather than a gap to be filled.

---

## 1. Dataset Overview

### 1.1 File inventory

558 files, 204.4 MB.

| Extension | Files | Size | What it is |
| --- | ---: | ---: | --- |
| `.dwg` | 146 | 158.3 MB | Native AutoCAD drawings. **77 % of the bytes.** |
| `.pdf` | 154 | 24.5 MB | Plotted sheets |
| `.png` | 154 | 18.6 MB | Preview renders **of the PDFs**, under `previews/` |
| `.md` | 51 | 0.3 MB | One README per hospital, plus repository docs |
| `.json` | 49 | 2.7 MB | 3 dataset-level indexes + 46 per-hospital `meta.json` |
| `.ps1`, `.bat` | 2 | — | Windows upload helpers |
| *(none)* | 2 | — | `LICENSE.md` adjuncts / git housekeeping |

The 154 PNGs are **derived**, not sources: each is a render of the PDF beside it. Counting them as
drawings would double every sheet and offer a lossy raster of a vector export as an equal to it.

### 1.2 Structure

```
MFD-Hospital-Dataset/
  Hospital_001 … Hospital_045/     45 project folders
    *.pdf  *.dwg                   the drawings
    previews/*.png                 renders of the PDFs
    meta.json  README.md           per-project index and description
  _reference/                      13 drawings: workshop sheets, an interior detail, a sample
  metadata/
    hospitals.json                 46 records
    drawings.json                  300 records
    equipment.json                 controlled vocabulary
```

**The delivered layout differs from the decision.** The decision specified
`dataset/Hospital_001/`; the repository puts the hospital folders at the root. The ingester accepts
both — refusing a real dataset over a directory name would be pedantry — but the discrepancy is
recorded here rather than silently absorbed.

`_reference/` is not a hospital. The dataset's own index counts it as a 46th `hospital_id`, which is
why **46 hospital records describe 45 hospitals**. It is catalogued rather than skipped so the
total reconciles to 300; excluding it produced 287 of 300, and a 13-file gap nobody can account for
is worse than a folder classified as `facility_type: reference`.

### 1.3 Record and column counts

| Table | Records | Columns |
| --- | ---: | ---: |
| `hospitals.json → .hospitals` | 46 | 14 |
| `drawings.json → .drawings` | 300 | 12 (+ 11 nested under `analysis`) |
| `equipment.json → .room_types` | 17 | 5 |
| `equipment.json → .layout_patterns_observed` | 148 | free text |
| `drawings[].analysis.rooms` | 1,797 | 4 |
| `drawings[].analysis.key_dimensions_mm` | 2,916 | free text |

`Hospital_NNN/meta.json` duplicates that hospital's record from `hospitals.json`; it was verified
identical in structure and is not counted separately.

### 1.4 Missing values

**`hospitals.json`** — 14 columns, 46 records:

| Column | Missing/empty | Note |
| --- | ---: | --- |
| `bed_count_min`, `bed_count_max`, `bed_counts_observed` | 9 | Projects where no sheet was legible enough to count |
| `layout_variants` | 17 | Projects with a single layout |
| `features_present` | 6 | |
| all others | 0 | |

**`drawings.json`** — 12 columns, 300 records:

| Column | Missing/empty | Note |
| --- | ---: | --- |
| `revision` | 267 | Only 33 sheets carry one |
| `beds_from_filename` | 249 | |
| `duplicate_sources` | 281 | 19 sheets came from more than one original path |
| `variant` | 150 | |
| `preview` | 146 | Exactly the DWG count — DWGs have no preview |
| **`analysis`** | **71** | **All 71 are DWG.** See §3.1 |
| all others | 0 | |

### 1.5 Duplicates

- **Byte-identical files: 0.** Every one of the 300 drawings has a distinct SHA-256.
- The dataset's own `duplicate_sources` field records that **19 drawings** were collected from more
  than one original path — de-duplicated before delivery, with the collision recorded rather than
  discarded. That is good practice and is noted as such.

---

## 2. Data Dictionary

Privacy column: **P0** none · **P1** commercially confidential · **P2** personal data.
No column in this dataset is health data about an individual.

### 2.1 `hospitals.json → .hospitals`

| Column | Meaning | Type | Example | Quality issues | Privacy |
| --- | --- | --- | --- | --- | --- |
| `id` | Anonymised project key | string | `Hospital_001` | — | P0 |
| `name_ko` | Facility name, Korean | string | `감만동 봉생병원` | **Real customer names.** One value, `강지점장님 신규`, is a person's title ("Branch Manager Kang — new"), not a facility | **P2** |
| `name_en` | Facility name, English | string | `Bongseng Hospital (Gammandong)` | Transliterated; UNKNOWN whether by the operator or automatically | **P1** |
| `facility_type` | Care setting | enum(7) | `general_hospital` | 5 records `unknown`; 1 is `reference` (not a facility) | P1 |
| `drawing_count` | Sheets in this project | int | 8 | Consistent with `files` in all 46 | P0 |
| `pdf_count`, `dwg_count` | Split by format | int | 5, 3 | Sum equals `drawing_count` in all 46 | P0 |
| `bed_count_min` / `_max` | Range of stations across this project's sheets | int | 25 / 30 | 9 records empty | P1 |
| `bed_counts_observed` | Every distinct count seen | int[] | `[25, 30]` | 9 empty | P1 |
| `features_present` | Room types present anywhere in the project | string[] | `["ro_room", …]` | 6 empty; vocabulary matches `equipment.json` | P0 |
| `layout_variants` | Design options offered | string[] | `["A"]` | 17 empty | P1 |
| `roles` | Sheet roles present | string[] | `["dialysis_layout"]` | — | P0 |
| `files` | Nested per-sheet index | object[] | | Duplicates `drawings.json`; see §3.5 | P1 |

### 2.2 `drawings.json → .drawings`

| Column | Meaning | Type | Example | Quality issues | Privacy |
| --- | --- | --- | --- | --- | --- |
| `hospital_id` | FK → `hospitals.id` | string | `Hospital_001` | Integrity clean (§3.5) | P0 |
| `file` | Filename within the folder | string | `dialysis_5.pdf` | — | P0 |
| `format` | `PDF` \| `DWG` | enum | `PDF` | Upper case here, lower case in our catalogue — normalised on ingest | P0 |
| `role` | What the sheet is for | enum(7) | `dialysis_layout` | — | P0 |
| `variant` | Design option | string | `A` | 150 empty | P0 |
| `revision` | Revision as delivered | string | `Rev.01` | 267 empty. Values consistent (`Rev.01`–`Rev.04`) | P0 |
| `bytes` | File size | int | 102,713 | Range 15 KB – 15.0 MB; no zero-byte files | P0 |
| `source_path` | **Original path before anonymisation** | string | `감만동 봉생병원/감만동 봉생병원 5-15.pdf` | **Re-identifies every drawing** — defeats the `Hospital_NNN` key | **P2** |
| `preview` | Path to the PNG render | string | `previews/dialysis_5.png` | 146 empty (all DWG) | P0 |
| `duplicate_sources` | Other original paths with identical content | string[] | | 281 empty | **P2** |
| `beds_from_filename` | Station count parsed from the filename | int | 30 | 249 empty; **derived, not observed** | P1 |
| `analysis` | Nested reading of the sheet | object | | **71 empty, all DWG.** Provenance UNKNOWN — §3.6 | P1 |

### 2.3 `drawings[].analysis` — 11 columns, 229 populated

| Column | Meaning | Type | Example | Quality issues | Privacy |
| --- | --- | --- | --- | --- | --- |
| `bed_count` | Stations on this sheet | int | 25 | Present on 198 of 300 | P1 |
| `bed_count_source` | **How it was established** | enum(4) | `counted_symbols` | `counted_symbols` 112 · `numbered_beds` 59 · `title_text` 27 · `not_legible` 31. **A stated method — the most valuable column here** | P0 |
| `legibility` | Reader's confidence | enum(3) | `high` | high 139 · medium 80 · low 10 | P0 |
| `rooms` | Rooms identified | object[] | | 1,797 rows; 259 have `canonical: null` | P1 |
| `key_dimensions_mm` | **Printed dimensions read off the sheet** | string[] | `"1800 (베드 간격)"` | 2,916 rows. **Free text, Korean-annotated.** 100 % have a leading parseable number; the annotation needs a mapping (§3.3) | P0 |
| `bed_layout_pattern` | Arrangement, in prose | string | `3열 병렬 배치 …` | Free text; not queryable | P0 |
| `bed_numbering` | Whether stations are numbered | string | `없음` | Free text where an enum would serve | P0 |
| `equipment_labels` | Equipment named on the sheet | string[] | `["BED", "CWP100H"]` | | P0 |
| `features` | Room-type presence flags | object(11 bool) | `{"ro_room": true, …}` | Complete and consistent | P0 |
| `drawing_title` | Title block title | string \| null | | Mostly null | P1 |
| `titleblock_notes` | **Title block contents, incl. scale** | string | `축척/타이틀블록 표기 없음` | 229 present; **212 say there is no scale notation.** See §3.2 — the single most consequential finding | P1 |

### 2.4 `analysis.rooms[]`

| Column | Meaning | Type | Example | Quality issues |
| --- | --- | --- | --- | --- |
| `label_ko` | Room label as drawn | string | `조제실` | As printed, including spacing variants |
| `label_en` | Translation | string | `dispensary / preparation room` | Sometimes two glosses in one string |
| `canonical` | Normalised id | string \| null | `preparation_room` | **259 of 1,797 null.** Every non-null value is in the `equipment.json` vocabulary — zero orphans |
| `dimensions_mm` | Room size as printed | string \| null | `"2,500 x 2,400"`, `"4,400 (한 변)"` | 916 of 1,797 present. Free text, three shapes: `W x D`, single value, annotated |

### 2.5 `equipment.json`

| Key | Meaning | Type | Note |
| --- | --- | --- | --- |
| `room_types` | Controlled vocabulary, 17 ids | object[] | Each carries `aliases` — the actual spellings found on drawings. **This is the join key that makes the room data usable** |
| `dialysis_equipment.bed_station` | Station symbol conventions | object | Notes a 1,800 mm bed+equipment module width "in some drawings" |
| `dialysis_equipment.water_treatment_units` | RO models observed | object[] | e.g. `CWP100H`, observed 8 times |
| `layout_patterns_observed` | 148 prose descriptions | string[] | Free text; a corpus, not a schema |

---

## 3. Data Quality Assessment

### 3.1 Missing data — one systematic gap

**71 of 300 drawings have no `analysis`, and all 71 are DWG.** DWG coverage is 75 of 146 (51 %);
PDF coverage is 154 of 154 (100 %).

This is not random. Whatever produced the analysis could read PDFs and could read only half the
DWGs. Since DWG is 77 % of the dataset by size and 49 % by count, **half the corpus is currently
unread**, and no tool in this application reads DWG at all. §8 treats this as the largest single
decision the dataset forces.

### 3.2 The scale problem — the finding that governs everything else

| | Drawings |
| --- | ---: |
| Analysed sheets | 229 |
| Title block states **no scale** (`표기 없음`) | **212** |
| Title block contains a `1:N` ratio | **12** |
| Sheets carrying **printed dimensions** | **210 of 229 (92 %)** |
| Sheets with no printed dimension at all | 19 |

Two consequences, and they point the same way:

1. **Dimension-line calibration works on 92 % of analysed sheets.** The method chosen as preferred
   in decision Q-4 is the one this corpus actually supports.
2. **The printed-scale fallback is nearly useless here — 12 sheets.** It was implemented on the
   assumption it would rescue drawings without dimensions; on this data it rescues almost none, and
   the 19 sheets with neither remain uncalibratable. That is worth knowing before any effort is
   spent widening it.

### 3.2a The stated scale is wrong on a quarter of the sheets that state one

Of the 6 sheets whose title block names a paper size, **3 name a size the file is not**:

| Drawing | Title block claims | File actually is | Consequence |
| --- | --- | --- | --- |
| `Hospital_026/dialysis.pdf` | `A3 : 1/200` | **A4** | 1/200 is not the scale of this file |
| `Hospital_026/dialysis_25bed.pdf` | `A3 : 1/200` | **A4** | as above |
| `Hospital_026/dialysis_2.pdf` | `A3 : 1/200` | **A4** | as above |
| `Hospital_016/dialysis.pdf` | `A3 : 1/150` | A3 | consistent |
| `Hospital_044/dialysis.pdf` | `A3 : 1/100` | A3 | consistent |
| `Hospital_044/ro_room.pdf` | `A3 : 1/100` | A3 | consistent |

An A3 sheet plotted to A4 is scaled to about 71 % of its stated size. Calibrating those three
drawings from their printed ratio would produce every measurement roughly **41 % too large**, with
nothing on the drawing to contradict it.

This is direct evidence for the caveat attached to the printed-scale route — *"it assumes the sheet
was neither rescaled on printing nor cropped on scanning"* — found by measuring the files rather
than trusting their title blocks. It confirms the Q-4 priority ordering was right, and it is why the
route is offered second and labelled weaker rather than treated as an equal alternative.

**It also means the stated-ratio path needs a guard the current implementation does not have:** when
a title block names a paper size, the importer can compare it against the page and refuse the
conversion if they disagree. That check is cheap, it is decisive, and this dataset shows it would
have fired on half the sheets it applies to. Recommended in §8.2.

### 3.3 Invalid values and inconsistent formats

| Issue | Extent | Assessment |
| --- | --- | --- |
| **Title block claims a sheet size the file is not** | **3 of 6 sheets that name one** | **The most consequential defect found.** `Hospital_026`'s three sheets print `A3 : 1/200`; the delivered PDFs are **A4**. The sheet was rescaled on plotting, so 1/200 is *not* the scale of the file. See §3.2a |
| Filenames are not unique | 127 distinct names for 300 files | `dialysis.dwg` occurs 21 times, `dialysis_typeA.pdf` 16. A filename alone cannot key a drawing; our catalogue keys on `hospital_id/filename`, verified unique across all 300 |
| `key_dimensions_mm` is free text | 2,916 rows | 100 % have a parseable leading number; the Korean annotation (`베드 간격` = bed pitch, `베드 열 길이` = bed row length) carries the meaning. Needs a controlled mapping before any figure is used |
| Thousands separators inconsistent | `8,150` vs `1800` | Both appear; parser must handle both |
| `rooms[].dimensions_mm` has three shapes | 916 rows | `W x D`, single value, and annotated single value |
| `bed_numbering` is free text | 229 rows | `없음` / prose where an enum would serve |
| `format` case | 300 rows | `PDF`/`DWG` upper case; our catalogue normalises to lower |
| `facility_type: unknown` | 5 records | Correctly marked unknown rather than guessed — good practice |
| `facility_type: reference` | 1 record | `_reference` is not a facility; the enum is being used to carry a structural distinction |

### 3.4 Outliers

- `bed_count`: 7 – 50, median 21, n = 198. The distribution has strong modes at **20 (47 sheets)**
  and **30 (29)** — round design targets, not measurement noise. No implausible values.
- File size: 15 KB – 15.0 MB. The largest are DWG. No zero-byte or truncated files.
- **No statistical outlier requires removal.** The `bed_count` spread is genuine variation between
  a 7-station clinic and a 50-station unit.

### 3.5 Referential integrity — clean

Every check passed with zero exceptions:

- All 300 `hospital_id` values resolve to a record in `hospitals.json`.
- No hospital record lacks drawings.
- `hospitals[].files[]` and `drawings[]` describe **exactly** the same 300 sheets — no row on either
  side without a partner.
- `drawing_count == len(files)` for all 46.
- `pdf_count + dwg_count == drawing_count` for all 46.
- Every non-null `rooms[].canonical` is in the `equipment.json` vocabulary — **zero orphan ids**.

This is a well-constructed dataset. The integrity is better than most production databases.

### 3.6 Provenance of `analysis` — **UNKNOWN, and it matters**

Nothing in the repository states **who or what produced the `analysis` block**. The fields
(`bed_count_source`, `legibility`) are the shape a careful reader produces, and the prose is fluent
Korean technical description — but the dataset does not say whether an engineer, a script, or a
model wrote it.

This is not a minor documentation gap. This application's knowledge layer requires every recorded
figure to name its method **and its observer**, because a citation nobody can be held to is not a
citation. Until this is answered, figures derived from `analysis` can be traced to a *drawing* but
not to an *observer*. §8 lists it as the first question to resolve.

---

## 4. Entity Model

### 4.1 What is actually here

```
        ┌────────────────┐
        │    Hospital    │  46 (45 facilities + 1 reference collection)
        │ id, name_ko/en │
        │ facility_type  │
        └───────┬────────┘
                │ 1
                │
                │ N          ┌──────────────────────────┐
        ┌───────┴────────┐   │      DrawingAnalysis     │ 229
        │    Drawing     │1—1│ bed_count, source,       │
        │ file, format,  │   │ legibility, patterns     │
        │ role, revision │   └───┬──────────────┬───────┘
        │ bytes, sha256  │       │ 1..N         │ 1..N
        └───────┬────────┘       │              │
                │ 0..1     ┌─────┴─────┐  ┌─────┴──────────┐
        ┌───────┴────────┐ │   Room    │  │  KeyDimension  │
        │    Preview     │ │ label_ko, │  │  value + Korean│
        │  (PNG render)  │ │ canonical │  │  annotation    │
        └────────────────┘ └─────┬─────┘  └────────────────┘
                                 │ N
                                 │ 1
                         ┌───────┴────────┐      ┌──────────────────┐
                         │   RoomType     │ 17   │ EquipmentLabel   │
                         │ id, aliases[]  │      │ BED, CWP100H, …  │
                         └────────────────┘      └──────────────────┘
```

**Cardinalities, verified:** Hospital 1—N Drawing (46 → 300). Drawing 1—0..1 DrawingAnalysis
(154/154 PDF, 75/146 DWG). Drawing 1—0..1 Preview (154 PNG, DWG none). DrawingAnalysis 1—N Room
(1,797) and 1—N KeyDimension (2,916). Room N—1 RoomType via `canonical`, with `aliases` as the
lookup — **zero orphans**.

### 4.2 The entities that were suggested and do not exist

The brief offered Patient, Doctor, Department, Visit, Diagnosis, Treatment, Medication and Billing
as examples. **None of them is present, and none can be derived.**

| Suggested entity | Present? |
| --- | --- |
| Patient, Doctor, Visit, Diagnosis, Treatment, Medication, Billing | **No.** No table, column or free-text field contains clinical or personal-care data |
| Department | **Partially** — as *rooms on a floor plan*, not as an organisational unit |
| Hospital | **Yes**, as a building project — no organisational or clinical attributes |

This is a **facility-design corpus**. Modelling it as a clinical database would produce an ER
diagram with eight empty tables and would misrepresent what the data can support. Recorded here
explicitly so the question is closed rather than revisited.

---

## 5. AI/ML Potential

Ranked by what this data can actually support. Every entry states the honest sample size, because
`n` decides which of these is a model and which is a lookup table.

| # | Application | Input | Output | Model candidate | n | Business value |
| --- | --- | --- | --- | --- | ---: | --- |
| 1 | **Room-label normalisation** | Korean label as drawn | Canonical room id | Dictionary + fuzzy match on `aliases`; no ML needed | 1,797 | **Highest.** Already 86 % solved by the shipped vocabulary; closes the 259 nulls |
| 2 | **Dimension-annotation parsing** | `"1800 (베드 간격)"` | (`station_pitch`, 1800 mm) | Rules over a controlled annotation vocabulary | 2,916 | **Highest.** Unlocks every measured figure in the corpus. Rules, not ML — the annotations are a small closed set |
| 3 | **Station-count estimation** | Room dimensions + type | Feasible station count | Regression | 198 | Real. Answers "how many stations fit" from observed practice rather than assumption |
| 4 | **Layout-pattern classification** | Floor plan geometry | `rows` / `islands` / `perimeter` / `mixed` | Supervised, over the 148 prose descriptions once coded | 148 | Moderate. Requires labelling the prose first |
| 5 | **Room-adjacency recommendation** | Programme of rooms | Recommended adjacencies | Association rules over `features` + `rooms` | 229 | Real. "RO room next to treatment in N of M units" is directly useful |
| 6 | **Layout optimisation seeding** | Room + equipment | Candidate arrangements | **Not ML** — the existing deterministic solver, seeded with observed pitch | 210 | **Highest, and already built.** The solver exists; this data supplies the figures it currently lacks |
| 7 | **Legibility triage** | Page raster | high/medium/low | Image classifier | 229 | Low. 229 labels is thin, and a human decides in seconds |
| 8 | **Drawing-role classification** | Page raster/text | `dialysis_layout` / `ro_room` / … | Image or text classifier | 300 | Low. The dataset already carries the labels |
| 9 | **Anomaly detection on layouts** | Layout features | Outlier score | Isolation forest | 229 | **Not recommended.** An unusual layout is not a wrong layout, and this product must never imply otherwise |

**The honest headline: the two highest-value items are rules, not models.** Normalising the labels
and parsing the annotations converts a prose corpus into 2,916 measured figures with drawings
behind them. No inference is required, and the owner's standing instruction — *"do not start AI
inference yet"* — is not in tension with any of it.

---

## 6. Privacy and Security Review

### 6.1 Classification

| Category | Present | Detail |
| --- | --- | --- |
| **Protected health information** | **None** | No patient, diagnosis, treatment, medication or billing data exists in any file |
| **Personal data** | **Yes, limited** | `name_ko` includes `강지점장님 신규` — a named individual's title, not a facility. `source_path` on all 300 rows carries the original Korean facility folder names |
| **Commercially confidential** | **Yes, throughout** | 45 identifiable customer facilities with full internal layouts, bed counts and equipment. Competitively sensitive to Vantive and to the hospitals |
| **Operational leakage** | **Yes, minor** | `dataset.source` is the author's machine path: `D:/도면/도면 컴퓨터 Baxter` |
| **Security-sensitive building data** | **Yes** | Floor plans of operating healthcare facilities, including utility rooms |

### 6.2 What anonymisation actually achieved

The `Hospital_NNN` keys suggest anonymisation. **It does not hold:** `source_path` on every one of
the 300 rows contains the original folder name, so `Hospital_001` → `감만동 봉생병원` is a lookup
away. `name_ko` states it outright.

That is a **defensible choice for an internal engineering dataset** — an engineer needs to know
which project a drawing came from. It is not anonymisation, and treating it as such is the risk.

### 6.3 Required actions

1. **Do not vendor this dataset into the application repository.** Already the standing decision;
   this audit confirms why. Once real hospital layouts enter a git history they cannot be removed.
2. **Never publish derived knowledge that names a facility.** The knowledge layer already aggregates
   across drawings, which is the right shape — *"station pitch across 14 drawings is 1,700–2,100 mm"*
   carries no customer's identity. `dataset.redistribution` is set to `derived_knowledge_only`.
3. **`강지점장님 신규` should be renamed.** A person's name in a facility field is personal data
   sitting where nobody will look for it. **Owner decision required.**
4. **Consider removing `dataset.source`.** The author's machine path has no engineering value.
5. **Confirm customer consent.** Publishing aggregate figures derived from 45 identifiable
   customers' drawings may require agreement. **This is a commercial question, not a technical
   one, and is outside what I can decide.**

---

## 7. Database Migration Design

Four layers. The boundary that matters is between Clean and Feature: **that is where observation
becomes inference**, and it is where every provenance rule has to hold.

```
┌─ RAW ─────────────────────────────────────────────────────────────┐
│  The dataset repository, unmodified, referenced by commit.        │
│  drawing(sha256 PK, hospital_id, path, format, role, revision,    │
│          bytes, page_count, sheet_size, effective_dpi)            │
│  raw_analysis(sha256 FK, json)   ← verbatim, never edited         │
│  Rule: append-only. Content-addressed. A drawing is its bytes.    │
└───────────────────────┬───────────────────────────────────────────┘
                        │  normalise · no interpretation
┌─ CLEAN ───────────────▼───────────────────────────────────────────┐
│  hospital(id PK, name_ko, name_en, facility_type)                 │
│  drawing(sha256 PK, hospital_id FK, role, revision, legibility)   │
│  room(id PK, sha256 FK, label_ko, canonical FK, width, depth)     │
│  dimension(id PK, sha256 FK, name, millimetres, annotation)       │
│      ← the 2,916 free-text strings parsed into typed rows         │
│  room_type(canonical PK, label_ko, label_en, aliases[])           │
│  Rule: every row traces to one sha256. Unparseable stays NULL     │
│        and is counted, never dropped.                             │
└───────────────────────┬───────────────────────────────────────────┘
                        │  aggregate · support counted
┌─ FEATURE ─────────────▼───────────────────────────────────────────┐
│  observation(id PK, drawing_sha256 FK, method, observed_by,       │
│              kind, value)          ← @mfd/layout-knowledge        │
│  knowledge_entry(id PK, kind, subject, min, median, max,          │
│                  support_drawings, support_observations)          │
│  Rule: median is a REAL READING, never a computed midpoint.       │
│        Support counts distinct drawings, not rows.                │
│        Below 3 drawings it is one site's choice, not a pattern.   │
└───────────────────────┬───────────────────────────────────────────┘
                        │  consume · advisory only
┌─ AI / APPLICATION ────▼───────────────────────────────────────────┐
│  The deterministic solver, reading knowledge through the          │
│  KnowledgeBase API.                                               │
│  Rule: NOTHING HERE DECIDES COMPLIANCE. Verdicts come from        │
│        standards/ alone. Observed practice may seed a default     │
│        or rank a candidate; it may never set a threshold.         │
└───────────────────────────────────────────────────────────────────┘
```

The Feature and AI layers are **already built** — `@mfd/layout-knowledge`, with the rule-engine
boundary enforced by a test. What this audit shows is missing is the **Clean layer**: the parsing
that turns 2,916 annotated strings and 1,797 room labels into typed rows.

---

## 8. Recommended Next Steps

### 8.1 Questions to resolve first — both block clean work

1. **Who or what wrote `analysis`?** (§3.6) The knowledge layer records an observer for every
   figure. If it was an engineer, name them and the figures are citable today. If it was a model,
   that is workable — the observation records the tool honestly — but the field currently says an
   observer must be a person, and I will amend it deliberately rather than quietly write a
   model's output into a field that promises a human. **I will not proceed to extraction until this
   is answered**, because the answer changes what every derived figure claims.
2. **Is `강지점장님 신규` a facility?** (§6.3) A person's name in a facility field.

### 8.2 Data cleaning, in dependency order

1. **Room-label normalisation** — close the 259 null `canonical` values using the `aliases`
   vocabulary. Pure lookup; no judgement.
2. **Dimension-annotation mapping** — build the controlled vocabulary from the Korean annotations
   (`베드 간격` → `station_pitch`, `베드 열 길이` → row length, …). **This is the highest-value single
   task in the audit:** it converts 2,916 strings into measured figures with drawings behind them,
   and it directly fills `delivery_crate_allowance`, `station_pitch` and `aisle_width` — the
   entries the solver currently reports as unavailable.
3. **Room dimension parsing** — the three shapes in §3.3, 916 rows.
4. **Layout-pattern coding** — the 148 prose descriptions into the `STATION_ARRANGEMENTS` enum.
   Last, because it needs judgement and the earlier steps do not.

**One code change is warranted by §3.2a, ahead of all of the above:** when a title block names a
paper size, compare it against the actual page and refuse the printed-scale conversion when they
disagree. On this dataset that guard fires on 3 of the 6 sheets it applies to, and each time it
prevents a ~41 % error that nothing on the drawing would have contradicted.

### 8.3 The DWG decision

**77 % of the bytes and half the drawings are DWG, and nothing in this application reads DWG.** Half
of them are additionally unanalysed. Three options, for the owner:

| Option | Cost | Effect |
| --- | --- | --- |
| Work from PDFs only | None | 154 sheets, all analysed. Sufficient to start |
| Convert DWG → PDF externally | Operator time | Doubles the corpus |
| Read DWG in-application | Substantial; new dependency | Not recommended now — a different product decision |

**Recommendation: start with PDFs.** 154 fully analysed sheets, 92 % carrying printed dimensions, is
more than enough to populate the knowledge base and prove the pipeline.

### 8.4 First verification drawing

Applying the criteria in `docs/verification/DRAWING_IMPORT_VERIFICATION.md`:

**`Hospital_044/dialysis.pdf`** — A3 vector CAD export, `dialysis_layout`, 10 stations counted from
symbols, 9 printed dimensions, 6 rooms identified, dated 2022.07.16, `SCALE : 1/100` **and the file
really is A3**.

It is the right first sheet because it is the rarest useful thing in the corpus: a drawing where
**both calibration routes can be run and compared**. Only 12 sheets state a scale at all, and of the
6 that also name a paper size, only 3 name the size the file actually is (§3.2a). This is one of
them, so its printed 1/100 can be converted honestly and then checked against a measurement taken
from its own dimension lines — an independent check on the whole calibration chain, not just on our
arithmetic. Every other sheet can be calibrated one way only, with nothing to check it against.

It also brings a companion: `Hospital_044/ro_room.pdf`, the same project at the same scale and
date, legibility `high`, giving an RO room to observe beside the treatment floor.

**I recommended `Hospital_026/dialysis_25bed.pdf` first and was wrong.** It looked ideal — 25
stations, high legibility, 32 dimensions, a stated 1/200 — until the page was measured and found to
be A4 against a title block claiming A3. Calibrating it from its stated ratio would have been ~41 %
out. The correction is recorded rather than quietly replaced, because it is the clearest available
illustration of why a title block is not evidence about a file.

Runners-up: `Hospital_016/dialysis.pdf` (A3 confirmed, `A3 : 1/150`, 28 dimensions, 18 rooms — richer
geometry, but `bed_count_source: not_legible`, so the station count cannot be read) and
`Hospital_043/dialysis.pdf` (A3, `SCALE : 1 /100`, but a scan rather than a vector export).

### 8.5 Model experiments — not yet

Per the standing instruction, no inference. The two highest-value items in §5 are rule-based and
need no model. Revisit after the Clean layer exists and there is something to learn from.

### 8.6 Visualisation

1. **Coverage dashboard** — which of the 46 projects have analysed sheets, dimensions, a scale. Makes
   the DWG gap and the scale gap visible rather than buried in this document.
2. **Station-pitch distribution** — the histogram behind any figure the solver would use, with `n`.
3. **Room-adjacency matrix** — which rooms neighbour which, across 229 sheets.
4. **Bed-count by facility type** — the 20 and 30 modes are visible and worth understanding.

---

## Summary

| | |
| --- | --- |
| **Integrity** | Excellent. Zero orphan foreign keys, zero byte-duplicates, all counts self-consistent |
| **Coverage** | PDF complete (154/154). **DWG half-analysed (75/146)** |
| **Usability for calibration** | **92 % of analysed sheets carry printed dimensions.** Only 12 state a scale |
| **Clinical data** | **None.** This is a facility-design corpus |
| **Privacy** | No PHI. Real customer identities throughout; `Hospital_NNN` is not anonymisation |
| **Largest gap** | The Clean layer — 2,916 dimension strings and 1,797 room labels are unparsed |
| **Sharpest defect** | 3 of 6 sheets naming a paper size name one the file is not — their stated scale is ~41 % wrong |
| **Blocking question** | **Who wrote `analysis`?** It decides what every derived figure may claim |
