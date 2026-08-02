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
