# Identity Migration — decision record

> **VantiCAD Layout** · Evidence-First Layout Decision Support · TS Edition
>
> Owner decision **D17**, revised: keep `sha256` as drawing identity, and **separate identity from
> aggregation** into three independent concepts.

**Nothing has been migrated.** No `drawingId` has changed, no committed artefact has been
regenerated, and this record exists because the owner required the migration to be an explicit
decision rather than a side effect.

---

## 1 · The three concepts

| Concept | Answers | Derived from | Status |
| --- | --- | --- | --- |
| **Drawing identity** — `drawingId` | *is this the same file evidence?* | `sha256` | Decided; **not migrated** |
| **Facility identity** — `facilityId` | *which site is this?* | An explicitly recorded field | Source exists ✅ |
| **Plan identity** — `planId` | *which design plan is this an export of?* | An explicitly recorded field | **No source exists** ❌ |

Neither aggregation identity may be derived from `drawingId`, and neither may be inferred from a
filename.

## 2 · Implemented now

`packages/layout-knowledge/src/identity.ts` — the three concepts as one place where the rule is true
rather than a rule everyone is asked to remember.

- `resolveFacility` / `resolvePlan` read **recorded fields only**. They do not take a `drawingId`
  parameter, so the rule cannot be broken by accident.
- **Both or neither**: an id with no `source` is not a recorded identity. An id somebody typed and
  a fact the dataset declared must not be indistinguishable.
- **Abstention, not fallback.** An unrecorded facility resolves to `null`. There is deliberately no
  fall-back to parsing the id, because a fallback is the forbidden inference wearing a safety label
  and a wrong grouping looks exactly like a right one.
- `countFacilities` / `countPlans` report `unknown` **separately** from the count. An unplaced record
  is one unknown, not its own facility — reporting it as a facility is precisely how `support`
  claimed 117 files of evidence over 24 sites.

11 tests, including the structural one: a record carrying a path-shaped `drawingId` and nothing else
resolves to `null`. That case goes red the day a fallback is added.

## 3 · What each remaining step requires

Not done, and each needs the decisions in §4 first.

| Step | What it needs |
| --- | --- |
| **Schema** | `facilityId`, `facilitySource`, `planId`, `planSource` on `drawingRecordSchema`. Adding required fields makes the committed `dataset.json` fail to parse until regenerated — and `dataset.json` still has no version field, so nothing would identify which shape a reader is holding |
| **Catalogue model** | `hospitalId` already exists as an explicit field. Facility resolution should read **it**, not parse the id. This is the smallest real fix in the set |
| **Corpus model** | 306 rows are keyed on path-derived `drawingId`. Re-identifying them by hash invalidates every `rowFingerprint`, and therefore every confirmation binding under D10 |
| **Ingest flow** | Populate `facilityId` from the dataset's own `hospital_id`, `facilitySource: 'dataset-metadata'` |
| **Aggregation** | `aggregate.ts` must call `resolveFacility`/`resolvePlan` instead of `facilityOf`/`planOf`, and must handle `unknown` |

## 4 · Decisions required

### 4.1 · Plan identity has no source — this blocks D15

**Measured in the dataset's own metadata:**

| | |
| --- | --- |
| `hospital_id` present on | **300 of 300** drawings ✅ |
| Any plan / design / group field | **none** ❌ |
| `duplicate_sources` present on | 19 of 300 |
| `variant` (`A`…`G`) | a layout variant, not a plan identity |

So `facilityId` can be recorded today from a genuine source. **`planId` cannot** — nothing in the
dataset declares which files are exports of one design.

Today `planOf` strips the file extension: `…/dialysis_24bed.dwg` and `…/dialysis_24bed.pdf` become
one plan. **That is filename inference**, which this decision forbids. Removing it without a
replacement means `support.plans` cannot be computed at all — and `plans` is currently
`z.number().int().positive()`, so it cannot simply become absent.

**Three options, none free:**

| | What it does | Cost |
| --- | --- | --- |
| **A · Abstain** | `planId` null everywhere; `support.plans` becomes unavailable, reported as unknown | D15's figure disappears from every knowledge entry until plans are recorded. Honest, and expensive |
| **B · Record plans by hand** | A person states which files are one plan, `planSource: 'human-recorded'` | 300 drawings to place. Correct, and the only option that produces a *fact* |
| **C · Keep extension-stripping, labelled** | `planSource: 'legacy-path-derived'`, so the record says the grouping was parsed | Keeps the figure and stops it masquerading as recorded — but it is still the inference, now merely honest about itself |

The `legacy-path-derived` source exists in the code for option C. **It is never produced** by
`identity.ts` — only read — so choosing C is a deliberate act rather than a default.

### 4.2 · Whether the 300 catalogued drawings are re-identified by hash

`drawingId` is currently path-derived for all 300. Re-identifying by `sha256`:

- invalidates all 306 corpus rows' `rowFingerprint`, and with them **any confirmation binding**
  under D10 — currently zero confirmations exist, so **this is the cheapest it will ever be**;
- makes the `.dwg`/`.pdf` twins two ids by content, which is correct under D17 and is exactly why
  §4.1 must be answered first;
- requires `dataset.json` to gain a version field, or nothing will identify which scheme a record
  was written under.

### 4.3 · Whether both schemes may coexist

If old records keep path ids and new uploads get hash ids, `drawingIdDerivedFrom` distinguishes
them — but every consumer must then handle both, and a consumer that forgets will be right on one
half of the corpus.

## 5 · What must not happen

- **No silent migration.** Regenerating `dataset.json` with new ids as a side effect of another
  change is the failure this record exists to prevent.
- **No inferred facility or plan.** Not from a filename, not from a path, not from a `drawingId`.
- **The confirmation boundary is untouched** by all of the above. No confirmation is created
  automatically, and re-identification does not sign anything.

## 6 · State

| | |
| --- | --- |
| `identity.ts` + tests | ✅ committed |
| Schema, catalogue, corpus, ingest, aggregation | ❌ blocked on §4 |
| Any migration | ❌ not started, and not to be started without §4.2 |
| **PILOT-001** | **Blocked until the identity model is resolved** |
