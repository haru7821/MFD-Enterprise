# Pilot-001 Validation Process

> **VantiCAD Layout** · Evidence-First Layout Decision Support · TS Edition
>
> The first real operational validation. Companion to
> [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md) §4 and
> [`release/RELEASE_GATE.md`](release/RELEASE_GATE.md) §3.

---

## 1 · What Pilot-001 is, and what it is not

**Pilot-001 is not a feature test.**

Every feature in this product already has automated coverage — 1,327 unit tests and 156 browser
specs, with guards verified by mutation rather than by passing. Running the pilot to find out
whether a button works would learn nothing the suite does not already establish.

What the suite **cannot** establish is whether the engine's claims survive contact with a real
drawing and a real engineer. Pilot-001 validates five things, in this order:

| | Validates | The question it answers |
| --- | --- | --- |
| 1 | **Evidence extraction** | Does the engine read from a real drawing what an engineer reads from it — and where it cannot, does it stop and say so, rather than producing a plausible number? |
| 2 | **Deterministic result generation** | Does the same drawing, re-run, produce byte-identical output on a different machine and a different day? |
| 3 | **Explanation correctness** | Does the sentence an engineer reads describe what the engine actually measured, in both languages? |
| 4 | **Engineer review process** | Can a Technical Service engineer follow the output to a judgement — and is the workflow one they can actually perform? |
| 5 | **Confirmation recording** | Does a real signature bind, persist, and survive a re-run without being destroyed or silently inherited? |

Item 5 is the one that cannot be simulated, and it is the reason this pilot exists. The D9–D12
confirmation chain has never seen a signature a person gave; every guard in it has been exercised
only against fixtures.

### What "success" means, and what it does not

**A stop is a valid outcome.** All 306 corpus rows currently stop — 211 at import, 80 at calibrate,
15 at room understanding — and a pilot run that stops is not a failed pilot. It is the engine
correctly declining to proceed on evidence it does not have.

Pilot-001 succeeds when the run's outcome — completed **or** stopped — is *correctly classified*,
*correctly explained*, and *confirmed by a person who checked it*. It does **not** require reaching
a completed run, and anyone treating a stop as failure will be under pressure to make the engine
guess, which is the one thing it must not do.

### A-1 is not resolved by this pilot

Installation planning standards are still absent, so every clearance rule carries a `null`
threshold, every clearance finding will read `RC-110`, and the report verdict will be
**판정 불가 / Inconclusive**. `compliance_margin` — 40 % of the scoring model — will be unmeasurable.

**This is the expected result, and it must not be worked around.** Supplying an estimated clearance
figure to make the pilot produce a verdict would invalidate the pilot and the product's entire
evidence model in one step. If a threshold is entered during Pilot-001, it must carry a document
number, a revision and a section — the schema will reject it otherwise, and that rejection is the
guard working.

---

## 2 · Pilot input record

Recorded **before** the run, so the run cannot be described after the fact by whatever it produced.

**The user uploads a drawing file. That is the only thing required of them.** Everything the system
can derive from the file, it derives; everything it cannot derive, it either asks for optionally or
defers to the stage where it is genuinely needed. A user who cannot name a `drawingId` is not
blocked, because inventing an identifier scheme for them to type was never protecting anything.

| Step | Who | Field |
| --- | --- | --- |
| 1 · Upload the drawing file | **User** | — the only required input |
| 2 · Generate the identifier | System | `drawingId`, `drawingIdDerivedFrom` |
| 3 · Record what was uploaded | System | `sourceFilename`, `sha256` |
| 4 · Detect the page count | System | `pageCount` |
| 5 · Select a page, or analyse the whole document | **User, optionally** | `selectionMode`, `selectedPages` |
| 6 · Requester and operator | User, optionally | `context.requestedBy`, `context.operator` |
| 7 · Reviewing engineer | **Not here** | Required only at the confirmation stage |

Still recorded, because they change the answer and the system knows them: catalogue record versions,
rule set id / version / status, scoring model ref, the git commit SHA (see below), and the execution
timestamp.

### The three rules this flow must not break

**Never infer which page contains the target room.** `selectionMode` is `user-selected` or
`full-document`, and there is deliberately no third option. If the user selects nothing, **every
page is analysed and reported separately** — the engine does not scan the document and pick the page
that looks like a dialysis room. Choosing a page is an engineering judgement about what the drawing
shows, and a wrong guess produces a confident result about the wrong room.

Implemented in `scripts/lib/pageSelection.ts` and driven by `verify:drawing`:

| Invocation | Selection |
| --- | --- |
| `--all-pages`, or no page argument | `full-document` — every page, one result each |
| `--page 2` / `--pages 0,2` | `user-selected`, recorded as such |
| A page outside the document | **Refused.** Not clamped — clamping page 7 to page 3 would analyse a real page nobody asked for and file it under a number nobody chose |
| Page count unreadable, nothing selected | **Refused.** Reading page 0 would report on an unknown fraction of the document |

`--page` no longer defaults to `0`: that default made *"nobody chose"* and *"page 0"* the same
input. The rule lives where a test can break it, because a page chosen by software and a page chosen
by a person produce identical-looking records.

**Never infer requester or reviewer identity.** Optional means **absent** — the key is omitted, not
filled with `unknown`, `system`, `TS team` or a role name. An absent key says nothing; a placeholder
says something false. That is owner decision D14's principle applied to people rather than to
frequencies.

**Never create a confirmation automatically.** Unchanged, and the reason the reviewing engineer is
not an input field at all: the person who signs is recorded at the moment they sign, in `review/`
and `confirmation/`, by them.

### `drawingId` is content identity — owner decision D17

> **`drawingId` derives from `sha256`.** Never from filename, upload event or folder structure. The
> same evidence must not create multiple drawing identities, because duplicates inflate evidence
> aggregation. Filename, revision and upload metadata are kept **separate from identity**.

| Derivation | Identical bytes re-uploaded | Same sheet, renamed |
| --- | --- | --- |
| **`sha256`** — decided | One entity | One entity |
| Filename | Two entities | One entity |
| Upload event | **Two entities** | Two entities |

`drawingIdDerivedFrom` records which rule produced a given id, so a record written under one scheme
is readable under another.

#### Not yet implemented, and why — `facilityOf`

`facilityOf(drawingId)` returns everything before the first `/`. A bare `sha256` has none, so it
returns the whole hash and **every drawing becomes its own facility**.

That inverts **D6**, which counts independent facilities precisely so one firm's template across
many files cannot read as consensus — measured at 117 files against 24 sites. Under a bare-hash id,
three sheets from one hospital count as three facilities: the same inflation D17 exists to prevent,
relocated from identity into grouping.

**`planOf` has the same problem.** D15 counts distinct plans so a `.dwg`/`.pdf` twin pair is not two
sheets of evidence — and two exports of one plan have *different bytes*, so content identity makes
them two ids.

So D17 needs a second change alongside it: **facility and plan must become recorded fields rather
than substrings of the id.** That is a schema change plus a regeneration of all 300 catalogue entries
and 306 corpus rows, and how existing path-derived ids are migrated is itself a decision.

Flipping the derivation alone would leave the suite green and silently break D6 and D15. It is
therefore raised rather than done — see
[`../pilot/PILOT-001/input/BLOCKED.md`](../pilot/PILOT-001/input/BLOCKED.md).

### Note — there is no solver version field

This is stated rather than papered over. The repository has no `SOLVER_VERSION` constant. The
identifiers that do exist are partial:

| Available | Identifies |
| --- | --- |
| `AI_CONTRACT_VERSION` = 1 | The request/response envelope shape |
| Scoring model `RefWithVersion` — `dialysis_default` `1.0.0` | The weights and `minimumCoverage` |
| `ruleSetId` + `ruleSetVersion` on the evaluation report | Which rules were applied |
| `EVALUATION_RESULT_VERSION` = 3, `DOCUMENT_VERSION` = 5 | Result and document shapes |

None of these changes when the solver's *logic* changes. **The git commit SHA is therefore the only
complete identifier of the code that produced a pilot result, and it is what the input record must
carry.** A shortened SHA is not sufficient for a record intended to be re-run against.

Adding a solver version is a source change and is out of scope here; it is recorded as a gap so the
pilot is run knowing it, rather than discovering it when a result cannot be reproduced.

### Review objective — what it is, and what it is not

This field was called **Engineering Question**, and the name was wrong in a specific and checkable
way: it implied an input that shapes the output. It does not. **The field is referenced nowhere in
`packages/`, `apps/`, `scripts/` or `tests/`** — verified — so the pipeline runs identically whatever
is written in it. A name suggesting the engine answers a question the user poses claims a behaviour
the code does not have, which is the class of overclaim this project exists to remove.

**The product assesses a drawing on the available evidence. It does not require a user to formulate
a question, and it does not select an answer from a question-shaped input.**

| | |
| --- | --- |
| **Belongs to** | The reviewer — it is what *they* intend to establish by examining this run |
| **Affects the engine** | No. Nothing in the pipeline reads it |
| **Affects the review** | Yes. It records why the run was performed, so the review knows what to examine |

**An objective can be satisfied by an abstention.** The word invites a met / not-met reading, and
that reading would be a defect: a result of *"the available evidence supports no statement about
station count"* **satisfies** an objective of establishing what the evidence supports. It is an
answer, not a failure to produce one.

The objective may not be phrased as an instruction to the engine, a target it must reach, or a
recommendation it must produce. If it can only be satisfied by a particular output, it is a
requirement rather than an objective, and it will put pressure on the run to guess.

### Also record, because it changes the answer

- Rule set status — every dialysis rule currently reads `status: draft` with `source.document: null`
- `planStatus` — whether the drawing was calibrated, and by which of the two methods
- The calibration basis — which printed dimension the scale was established from

---

## 3 · Geometry provenance

Three kinds of geometry. They must never be collapsed, because collapsing them is how a number an
engineer never checked acquires the authority of one they did.

| Tier | What it is | Comes from |
| --- | --- | --- |
| **1 · Drawing Evidence** | Information extracted from, or referenced in, the uploaded drawing | The sheet — dimension strings, a printed scale, line work, the title block |
| **2 · Verified Geometry** | Dimensions or spatial facts **confirmed by human input** | An engineer, who measured, typed or traced it and can say against what |
| **3 · Evaluation Geometry** | The geometry the solver **actually used** | The project document, as handed to the engine |

### The rules

1. **Do not assume drawing scale is accurate.**
2. **Do not infer missing dimensions from visual appearance.**
3. **Do not treat extracted dimensions as verified unless provenance is recorded.**
4. **Human-confirmed geometry must remain distinguishable from drawing-derived evidence.**

The load-bearing consequence: **every value in Tier 3 must trace to Tier 1 or Tier 2.** A number in
the evaluation geometry that traces to neither was inferred, and rule 2 forbids it. That is the
check the pilot performs — not "does the geometry look right", but "can each value say where it
came from".

### What the system enforces today, and what it does not

Stated precisely, because a process document describing a distinction the code does not make would
be the overclaim this project exists to remove.

**Scale — partially enforced.** `calibration.method` distinguishes a **two-point** calibration (an
engineer picked two points and typed the real distance) from a **stated ratio** read off the title
block, and the two are not interchangeable. The calibration safety rule refuses a printed scale that
the file's own sheet size contradicts, and reports the measured sheet size beside the claim rather
than silently overriding it — rule 1, implemented. Until a scale is established, `planStatus` is
provisional and every finding is capped at YELLOW.

**Shape — not represented at all.** `boundarySchema` and `spaceSchema` carry `vertices`, `kind` and
`label`, and **no provenance field**. A room outline is bare coordinates. Nothing in the document
model records whether a human traced it against the drawing, or what they traced it from.

So for **shape**, Tier 1 and Tier 2 are indistinguishable in the data, and Tier 3 is simply whatever
the document holds.

**Consequence for Pilot-001: the distinction must be recorded by hand in the run record.** The
schema cannot enforce it, and the pilot must not claim that it did. Closing the gap means adding a
provenance field to boundaries and spaces — a schema change, and therefore a source change, out of
scope here. Recorded so the run is performed knowing it rather than discovering it at review.

### Recording it

`input/run-metadata.json` carries a `geometry` block with the three tiers; the checklist has a
matching section. Both exist so the tiers are written down **as the run proceeds**, since after the
fact nobody can reconstruct which numbers a person actually checked.

## 4 · Review workflow

```
Input drawing
      ↓
Evidence extraction          pnpm verify:drawing — records where it stops
      ↓
Layout evaluation            rule engine + solver; abstains where it cannot measure
      ↓
Generated rationale          AR-xxx codes composed per language at render time
      ↓
Engineer review              a person reads the drawing and the output side by side
      ↓
Confirmation record          appended to knowledge/validation/confirmations.json
```

### Stage by stage

**Input drawing.** Catalogued, with a `sha256`. If the file's hash does not match the catalogue, the
run is against a different file and the record would be false.

**Evidence extraction.** `pnpm verify:drawing` drives the sheet through the pipeline and records
where it stopped and why, classified under the five-way taxonomy. *Any* stage may stop; the stop is
the record.

**Layout evaluation.** The rule engine judges and the solver ranks whatever survived extraction.
Expect `RC-110` on every clearance finding and an **Inconclusive** verdict — see §1.

**Generated rationale.** The engineer reads the explanation in both languages. This stage is
validating the *sentence*, not the score: an explanation that names a criterion the engine did not
measure, or omits an abstention, is a defect even if every number is right.

**Engineer review.** The judgement. The engineer compares the drawing against the output and decides
whether what the engine reported is what the drawing says. **The engine does not participate in this
stage.**

**Confirmation record.** §5.

### The review must be able to end in "no"

If the engineer finds the output wrong, the pilot outcome is a **defect report, not a confirmation**,
and no confirmation is recorded. A pilot that can only end in a signature is not a validation. This
is the single most important property of the workflow: the reviewer must be able to refuse, and
refusing must be a normal, recordable outcome rather than a failure of the exercise.

---

## 5 · Confirmation requirements

> A valid confirmation requires a **real engineer**, a **real drawing**, and an **actual review
> action**.

All three. A real engineer signing without reading the drawing satisfies none of what the
confirmation asserts.

### Excluded — none of these is a confirmation

- **Synthetic fixtures.** Including every confirmation already present in `verification.test.ts` and
  `corpusLedger.test.ts`. Those exist to test the mechanism, not to satisfy it.
- **Generated confirmations.** Anything authored by the engine, by a script, or by any agent in the
  development loop. A confirmation the system produces to clear its own gate is the system
  confirming itself — the exact failure the chain was built to prevent.
- **Replay tests.** A replayed, copied, or migrated confirmation from an earlier schema version
  asserts nothing about this run.
- Back-filling from the ledger's own contents, or a placeholder entered to move a count off zero.

**The distinction is not the file's syntax.** Every excluded form above would parse. What separates a
valid confirmation from an invalid one is whether a person looked and then signed — which no schema
can check, and which is why this is a gate on the release rather than a rule in the code.

### What a confirmation must carry

Appended by hand to `knowledge/validation/confirmations.json`; no tool authors one, and that is an
operational gap rather than a defect.

| Field | Requirement |
| --- | --- |
| `drawingId`, `page`, `sha256`, `reached`, `stoppedAt`, `discrepancies` | Copied **verbatim** from the ledger row — this is D10's binding |
| `kind` | `completion` or `stop`, **stated by the signer**, never inferred |
| `name` | The engineer. A person, not a role or a team |
| `at` | ISO-8601 instant with offset, in the signer's own timezone |
| `basis` | What they checked against — the drawing, a record, a site visit |

`kind` is stated rather than derived because signing the wrong one must be a **rejection**, not a
silent reclassification. A `completion` confirmation on a stopped row fails `confirmationSchema` in
`confirmations.json`'s own terms, naming the offending entry.

Given that all 306 rows currently stop, the act available in Pilot-001 is a **stop confirmation**
under D12 — *"this sheet genuinely carries no dimension a scale can be established from, and the
classification recorded against it is correct."*

### After the confirmation

1. `pnpm validate:corpus` merges it; `totals.stopsConfirmed` moves off zero.
2. Re-run and confirm the artefact is byte-identical apart from that count.
3. **Verify D10 by changing something.** The signature must stop applying if the pipeline's reading
   of that page changes. This has never been observed outside a fixture, and observing it once is a
   large part of what the pilot is for.
4. The record is committed and **never regenerated**. It becomes the reference record for future
   regression — the first number in the ledger a batch could not have produced.

---

## 6 · Checklist

A blank template is at [`pilot/PILOT-001-CHECKLIST.md`](pilot/PILOT-001-CHECKLIST.md).

**It ships blank on purpose.** Filling it with example values would put invented drawing
identifiers, invented hashes and an invented engineer's name into the repository, where the next
reader would have to work out which entries were real. This product's whole discipline is that a
statement must not exist before its evidence does, and a specimen checklist is a statement about a
run that never happened.

Copy it to `docs/pilot/PILOT-001.md` when the run is performed, and fill it in as the run proceeds
rather than afterwards.



---

## 7 · Run folder

Run artefacts live in [`../pilot/PILOT-001/`](../pilot/PILOT-001/), not in `docs/`. Each of its five
folders — `input`, `evidence`, `result`, `review`, `confirmation` — defines the files expected in it,
and the run metadata template is at `pilot/PILOT-001/input/run-metadata.template.json`.

The review outcome is exactly one of `confirmed`, `rejected` or `stopped`, and **only `confirmed`
produces a confirmation record**.
