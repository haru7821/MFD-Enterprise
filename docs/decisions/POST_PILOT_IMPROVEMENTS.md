# Post-Pilot Operational Improvements

> **VantiCAD Layout** · Evidence-First Layout Decision Support · TS Edition
>
> Recorded, **not scheduled and not implemented**. Nothing here may be started before Pilot-001
> completes and the first genuine human confirmation exists.

**The Pilot-001 process is FROZEN.** The only remaining objective before execution is obtaining a
real drawing.

## Priority order after Pilot-001 executes

| | |
| --- | --- |
| **1** | Complete the first genuine engineer review |
| **2** | Obtain the first real D9–D12 confirmation |
| **3** | Review all findings from Pilot-001 |
| **4** | Decide whether any finding requires a **product change**, a **documentation change**, a **process change**, or **no action** |

**Only after that review may new implementation work begin.**

Not to be started: **OI-1** (below), **D17** (deferred), or any new functionality.

**Pilot-001 is the baseline operational validation of VantiCAD Layout.** Every future improvement
must be justified by evidence collected during Pilot-001 or later real engineering use — including
everything recorded in this document. An item here is a candidate, not a commitment: if the pilot
produces no evidence that it matters, that is an answer, and *no action* is one of the four
outcomes priority 4 may reach.

---

## F-1 · The confirmation model cannot represent a mixed verdict

> **Architectural finding from Pilot-001.** Recorded, not fixed.
>
> The current confirmation model cannot represent mixed verdicts — **Confirmed + Inconclusive within
> a single review.**

**Found by using the product.** Every other item in this repository's backlog was found by reasoning
about the code. This one was found because a real engineer reviewed a real drawing and returned a
verdict the schema had no shape for.

| | |
| --- | --- |
| Run | PILOT-001 · `Hospital_044/dialysis.pdf`, stopped at `room` |
| `VD-4` | **Confirmed** — the stop judgement was appropriate |
| `VD-1` | **Inconclusive / 검증불가** — neither confirmed nor refuted |

A confirmation binds to `rowFingerprint(outcome)` under D10, and that fingerprint includes the
**whole discrepancy list**. It is a statement about the row. `confirmationSchema` has no field
meaning *"I confirmed this finding and could not verify that one."*

So a `stop` confirmation written from this review would record the stop as correctly diagnosed —
true — while carrying `VD-1` inside the fingerprint as though it had been checked. Nothing in the
artefact would distinguish *the signer verified both* from *the signer verified one and could not
reach the other*. **It would overstate by exactly one finding**, in the one file this product treats
as ground truth.

### Why no confirmation was created

> Owner decision: *"Do not create a confirmation that overstates what was actually reviewed."*

This is the governing reason, and it is stronger than the administrative one. A signer's `name` and
`basis` were also missing — but supplying them would not have made the confirmation honest, because
the shape itself cannot carry what the reviewer actually established.

**The first confirmation will be written when it can state the truth without exaggeration.** Not
before. `confirmations.json` remains `[]`, and
[`release/RELEASE_GATE.md`](../release/RELEASE_GATE.md) §3 therefore remains **not met** — now for a
principled reason rather than an unfinished one.

### Not to be acted on during Pilot-001

- **No schema change.** Not during the pilot.
- Whether one is needed at all is decided in the **post-pilot review** — priority 4, whose outcomes
  include **no action**. One unverifiable finding on one drawing may not justify changing a contract.

---

## F-2 · No input path for a human-confirmed room extent — **implemented**

> **Finding from real use, and the second one the pilot produced.** A drawing states its room as
> text — `Room: 25,000 x 15,000 mm` — with no dimension line and `Scale: fit-to-page`. Neither
> calibration method applies, so the pipeline stopped at `room` even though the number an engineer
> needs was printed on the sheet.

**The gap was not the incomplete drawing.** The solver takes a polygon in millimetres; nothing about
that requires calibrating an image. What was missing was a way to say *"the room is 25,000 × 15,000,
and here is who says so"*. Geometry provenance already defined the tier — **Tier 2, Verified
Geometry, confirmed by human input** — and had no input path.

Measured before building it: with the room supplied directly, the solver placed **12, 16 and 20
stations**, 0 rejections, and reported `total: null` at `coverage: 0.20` — below `minimumCoverage`
0.25. It shows arrangements and declines to rank them. That is D1 working, not a failure.

### `scripts/lib/statedRoom.ts` — 14 tests

The distinction it exists to enforce, because once both are numbers they are indistinguishable:

| Source | Tier | Usable as geometry |
| --- | --- | --- |
| `drawing-text` — read off the sheet, nobody checked it | 1 · Drawing Evidence | **No** |
| `human-confirmed` — a person states it and says against what | 2 · Verified Geometry | Yes |

- **A printed dimension is a claim the drawing makes**, not a measurement. It may be the building
  rather than the room; it may disagree with its own linework — Pilot-001's `VD-1` is exactly that,
  3.01 % out. `drawing-text` is recorded and **refused for geometry**, not discarded: it is the
  candidate a person is being asked to confirm.
- **Both attributions or none.** `human-confirmed` requires `statedBy` *and* `basis`. A number with
  a name but no basis says a person typed it; with a basis but no name, nobody is answerable. The
  same rule `confirmationSchema` already enforces.
- **No promotion path.** Supplying a name and basis on a `drawing-text` statement does not make it a
  confirmation, and `roomPolygon` has no `force` parameter — an escape hatch would be used.
- **The provenance reaches the reader.** `provenanceNote` states the room was *stated, not measured*,
  and that nothing checked the statement against the linework.

Both guards mutation-tested: allowing a polygon from unverified text, and dropping the basis
requirement, each turn the suite red.

**Not yet wired into `verify:drawing` or the editor.** The module is the decision layer; the
operator-facing path is the next step and needs its own decision about where the statement is
entered and recorded.

---

## OI-1 · File-first pilot workflow

> **The operator should never need to reference an internal catalogue identifier.** The workflow
> should be based on the drawing file itself.

| | Step | Who |
| --- | --- | --- |
| 1 | Upload a drawing (PDF) | Operator |
| 2 | Compute `sha256`, page count, file metadata | System |
| 3 | Create an **internal run identifier** | System |
| 4 | Select full document (default) or specific page(s) | Operator |
| 5 | Extraction and evaluation | Engine |
| 6 | Review the result | Engineer |

### This is not D17

Worth stating plainly, because the two look alike and the difference decides whether OI-1 is blocked:

| | D17 — identity migration | OI-1 — this |
| --- | --- | --- |
| Changes | What `drawingId` **means** across the whole repository | What the **operator has to type** |
| Touches | Catalogue, corpus, `rowFingerprint`, aggregation, D6/D15 | The entry point to a run |
| Scope | Repository-wide architectural change | Usability |

**Step 3's "internal run identifier" is a run identifier, not a drawing identity.** A run can carry
its own local id — recording the `sha256` it was computed from — without that id becoming the thing
`support` counts by. So **OI-1 does not depend on D17**, and implementing it must not quietly
perform D17 by another route.

Two guards the implementation inherits, both already decided:

- **Never infer which page contains the target room** (already implemented in
  `scripts/lib/pageSelection.ts`: `user-selected`, `full-document`, or a refusal — no third mode).
- **Never infer requester or reviewer identity.** Optional means absent.

### What it needs

One gap, already measured: **there is no single-file ingest path.** `drawingId` is built as
`${hospitalId}/${basename}`, which requires a hospital-shaped folder, so a loose uploaded file has
nowhere to be catalogued. `sha256`, page-count detection and per-page analysis all exist.

### Status

| | |
| --- | --- |
| Recorded | ✅ this document |
| Scheduled | ❌ not before Pilot-001 completes and the first confirmation exists |
| Implemented | ❌ nothing |
| Current pilot process | **Unchanged.** PILOT-001 continues on the existing catalogue-based workflow |

---

## Why these are recorded rather than built

Each of these makes the product easier to use. None of them makes the first confirmation more
truthful, and that confirmation is the only thing standing between this repository and a release it
can honestly claim. A usability improvement shipped first would delay the one measurement nobody has
taken yet — and it would change the workflow the pilot is meant to validate, so the pilot would be
validating something that had not been used.
