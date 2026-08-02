# Identity Migration — decision record

> **VantiCAD Layout** · Evidence-First Layout Decision Support · TS Edition
>
> Owner decision **D17**, revised: keep `sha256` as drawing identity, and **separate identity from
> aggregation** into three independent concepts.

**Decisions are made (§4). The migration is authorised and has NOT yet been executed** — see §7 for
the ordered plan and why it is one atomic step rather than several commits.

This record exists because the owner required the migration to be an explicit decision rather than a
side effect.

---

## 1 · The three concepts

| Concept | Answers | Derived from | Status |
| --- | --- | --- | --- |
| **Drawing identity** — `drawingId` | *is this the same file evidence?* | `sha256` | Decided; migration authorised, **not executed** |
| **Facility identity** — `facilityId` | *which site is this?* | The catalogue's existing `hospital_id` | Source exists on **300 of 300** ✅ |
| **Plan identity** — `planId` | *which design plan is this an export of?* | **Human-provided metadata** | Concept retained; **unpopulated** until a person records one |

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

Decisions are made; this is what each step involves. The ordering that makes it safe is §7.

| Step | What it needs |
| --- | --- |
| **Schema** | `facilityId`, `facilitySource`, `planId`, `planSource` on `drawingRecordSchema`. Adding required fields makes the committed `dataset.json` fail to parse until regenerated — and `dataset.json` still has no version field, so nothing would identify which shape a reader is holding |
| **Catalogue model** | `hospitalId` already exists as an explicit field. Facility resolution should read **it**, not parse the id. This is the smallest real fix in the set |
| **Corpus model** | 306 rows are keyed on path-derived `drawingId`. Re-identifying them by hash invalidates every `rowFingerprint`, and therefore every confirmation binding under D10 |
| **Ingest flow** | Populate `facilityId` from the dataset's own `hospital_id`, `facilitySource: 'dataset-metadata'` |
| **Aggregation** | `aggregate.ts` must call `resolveFacility`/`resolvePlan` instead of `facilityOf`/`planOf`, and must handle `unknown` |

## 4 · Decisions — MADE

> **Facility** — source is the existing `hospital_id`. Automatic, because the catalogue already
> provides the field.
>
> **Plan** — introduce an explicit `planId`, sourced from **human-provided metadata**. Do not infer
> it from filename, from geometry, or using AI. **The plan concept is not removed**; the
> filename-derived grouping is replaced by the explicit field.
>
> **Drawing** — `drawingId` derives from `sha256`, representing file content identity only.
>
> **File metadata** — original filename, revision information where provided, and upload metadata
> are kept **separate from identity**.
>
> **Migration** — no confirmations exist, so regenerate catalogue and corpus identity bindings
> before Pilot-001. Old drawing identifiers, row fingerprints and derived artefacts are invalidated
> and regenerated.

### 4.0 · What this means for `plans` on day one

`planId` is human-provided and **no human has provided one**, so after migration every record
carries `planId: null`. The concept exists and is unpopulated — which is the correct state, not a
gap to fill.

The consequence must be handled rather than absorbed: `support.plans` is currently
`z.number().int().positive()`, and with no plan recorded anywhere it cannot be a positive integer.
It becomes **unknown**, reported as such — the same treatment `frequencies` received under D14,
where an absent key was the only encoding that said nothing at all. `plans` must not silently become
`0`, and it must not fall back to the extension-stripping it is replacing.

### 4.1 · Superseded — the options that were open

#### Plan identity had no source — resolved by decision

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

**Option B was chosen** — plans are recorded by a person. Until they are, the field is null and the
count is unknown. The three options as put:

| | What it does | Cost |
| --- | --- | --- |
| **A · Abstain** | `planId` null everywhere; `support.plans` becomes unavailable, reported as unknown | D15's figure disappears from every knowledge entry until plans are recorded. Honest, and expensive |
| **B · Record plans by hand** | A person states which files are one plan, `planSource: 'human-recorded'` | 300 drawings to place. Correct, and the only option that produces a *fact* |
| **C · Keep extension-stripping, labelled** | `planSource: 'legacy-path-derived'`, so the record says the grouping was parsed | Keeps the figure and stops it masquerading as recorded — but it is still the inference, now merely honest about itself |

The `legacy-path-derived` source exists in the code for option C. **It is never produced** by
`identity.ts` — only read — so choosing C is a deliberate act rather than a default.

#### Re-identifying the 300 catalogued drawings — decided: yes, now

`drawingId` is currently path-derived for all 300. Re-identifying by `sha256`:

- invalidates all 306 corpus rows' `rowFingerprint`, and with them **any confirmation binding**
  under D10 — currently zero confirmations exist, so **this is the cheapest it will ever be**;
- makes the `.dwg`/`.pdf` twins two ids by content, which is correct under D17 and is exactly why
  §4.1 must be answered first;
- requires `dataset.json` to gain a version field, or nothing will identify which scheme a record
  was written under.

#### Coexistence — decided: no

One scheme. Old identifiers are invalidated rather than carried alongside, because a consumer that
handles one and forgets the other is right on half the corpus and silently wrong on the rest.

## 5 · What must not happen

- **No silent migration.** Regenerating `dataset.json` with new ids as a side effect of another
  change is the failure this record exists to prevent.
- **No inferred facility or plan.** Not from a filename, not from a path, not from a `drawingId`.
- **The confirmation boundary is untouched** by all of the above. No confirmation is created
  automatically, and re-identification does not sign anything.

## 7 · Execution plan — one atomic change

**Measured blast radius**, not estimated:

| | |
| --- | --- |
| Catalogued drawings, all with a `sha256` | **300 of 300** — every record can take a content id |
| Corpus rows to re-key | **306** |
| Verification records named from `drawingId` | 2 (`Hospital_044-*.json`) |
| Observation files carrying `drawingId` | 2 |
| Source/test files with path-shaped ids | **20 files, 23 occurrences** |
| Confirmations invalidated | **0** — the reason this is the cheapest it will ever be |

**Ordered, and it must land as one commit.** A repository whose `dataset.json` uses hash ids while
`corpus.json` still uses path ids is broken in a way neither file can detect: every join silently
returns nothing, and `support` would report zero evidence rather than failing.

1. `schema.ts` — `drawingRecordSchema` gains `facilityId`, `facilitySource`, `planId`, `planSource`,
   `sourceFilename`; `drawingId` becomes the 64-hex content id.
2. `ingest-dataset.ts` — `drawingId = sha256`; `facilityId` from `hospital_id` with
   `facilitySource: 'dataset-metadata'`; `planId: null`, `planSource: null`; filename and revision
   preserved as metadata.
3. `aggregate.ts` — delete `planOf`, stop calling `facilityOf`; use `resolveFacility` /
   `resolvePlan` from `identity.ts`. Handle `unknown` explicitly.
4. `provenance.ts` / `schema.ts` — `support.plans` becomes unknown-capable per §4.0.
5. Regenerate, in order: `dataset:ingest` → `knowledge:extract` → `knowledge:build` →
   `validate:corpus`. Verification record filenames change from `Hospital_044-dialysis` to the hash.
6. Update the 20 files carrying path-shaped ids.
7. Re-run the full validation set; confirm a second regeneration is byte-identical.

**Not started.** It is recorded here in full so the next session executes a plan rather than
rediscovers one, and so the ordering — which is the part that makes it safe — is not left to memory.

## 6 · State

| | |
| --- | --- |
| Decisions §4 | ✅ made by the owner |
| `identity.ts` + tests | ✅ committed — the resolution layer the migration targets |
| Schema, catalogue, corpus, ingest, aggregation | ❌ **authorised, not executed** — §7 |
| Artefact regeneration | ❌ not started |
| **PILOT-001** | **Blocked until §7 is executed** |

**Nothing in this record is a confirmation, and executing §7 creates none.** The confirmation
boundary, the evidence rules and the human review boundary are untouched by all of it.
