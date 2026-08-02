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

| Field | Meaning | Where it comes from |
| --- | --- | --- |
| **Drawing identifier** | `drawingId` of the sheet, plus `page` and `sha256` | `knowledge/dataset.json` — the catalogued entry. `sha256` proves the file run is the file catalogued |
| **Project context** | Facility, the **review objective**, and who asked for the review | The engineer. Not derivable from the repository |
| **Room type** | The room being evaluated | Dialysis for Pilot-001. The only room type with a rule set and a scoring model today |
| **Catalogue version** | `version` of every equipment record used | Each catalogue record, e.g. `vantive_ak98` `0.6.0`. Recorded **per record** — there is no single repo-wide catalogue version |
| **Solver version** | The exact code that produced the result | **See the note below** |
| **Execution date** | When the run was performed, ISO-8601 with offset | The operator, in their own timezone |

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

## 3 · Review workflow

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

**Confirmation record.** §4.

### The review must be able to end in "no"

If the engineer finds the output wrong, the pilot outcome is a **defect report, not a confirmation**,
and no confirmation is recorded. A pilot that can only end in a signature is not a validation. This
is the single most important property of the workflow: the reviewer must be able to refuse, and
refusing must be a normal, recordable outcome rather than a failure of the exercise.

---

## 4 · Confirmation requirements

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

## 5 · Checklist

A blank template is at [`pilot/PILOT-001-CHECKLIST.md`](pilot/PILOT-001-CHECKLIST.md).

**It ships blank on purpose.** Filling it with example values would put invented drawing
identifiers, invented hashes and an invented engineer's name into the repository, where the next
reader would have to work out which entries were real. This product's whole discipline is that a
statement must not exist before its evidence does, and a specimen checklist is a statement about a
run that never happened.

Copy it to `docs/pilot/PILOT-001.md` when the run is performed, and fill it in as the run proceeds
rather than afterwards.


