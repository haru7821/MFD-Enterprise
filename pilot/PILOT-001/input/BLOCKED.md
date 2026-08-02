# PILOT-001 — execution not started

> **Superseded — input model simplified.** The earlier version of this file recorded two blockers
> under the old input model, which required the user to type a `drawingId`, a `page`, an operator, a
> requester and a reviewing engineer. **Owner decision: none of those is required of the user.** The
> blockers they described are therefore no longer blockers, and are recorded below as history rather
> than deleted.

## What is required now

**One thing: the drawing file.**

| Step | Who | Status |
| --- | --- | --- |
| 1 · Upload the drawing file | **User** | ❌ **outstanding — the only blocker** |
| 2 · Generate `drawingId` | System | waiting on 1 |
| 3 · Record `sourceFilename` + `sha256` | System | waiting on 1 |
| 4 · Detect `pageCount` | System | waiting on 1 |
| 5 · Select page, or analyse full document | User, optional | defaults to `full-document` |
| 6 · Requester / operator | User, optional | absent is valid |
| 7 · Reviewing engineer | — | not an input; required only at confirmation |

Steps 5–7 cannot block anything: 5 has a defined default that infers nothing, and 6 and 7 are
optional or deferred by decision.

## D17 decided, and one consequence that blocks implementing it as written

> **Owner decision D17.** `drawingId` derives from **`sha256`** — content identity. Never from
> filename, upload event or folder structure. The same evidence must not create multiple drawing
> identities, because duplicates inflate evidence aggregation. Filename, revision and upload
> metadata are kept separate from identity.

The decision is right and the reason is the one that matters. **It cannot be applied as written
without a second change**, and the reason is the same aggregation the decision protects:

```ts
// packages/layout-knowledge/src/provenance.ts:302
export function facilityOf(drawingId: string): string {
  const separator = drawingId.indexOf('/');
  return separator === -1 ? drawingId : drawingId.slice(0, separator);
}
```

`facilityOf` reads the **site** out of the id string — everything before the first `/`. A bare
`sha256` contains no `/`, so it returns the whole hash and **every drawing becomes its own
facility**.

That inverts D6. Support counts independent facilities precisely so one firm's template across many
files cannot read as consensus — measured at 117 files against 24 sites. Under a bare-hash id, three
sheets from one hospital would count as three facilities: the same evidence inflation D17 exists to
prevent, moved from identity into grouping.

**What is needed:** facility must become a **recorded field** rather than a substring of the id.
That is a schema change to the dataset entry plus a rewrite of `facilityOf`, and it invalidates the
grouping behind every one of the 306 committed corpus rows and 300 catalogue entries until they are
regenerated with the field present.

Two further consequences worth deciding at the same time:

- **`planOf`** — D15 counts distinct plans so a `.dwg`/`.pdf` twin pair is not two sheets of
  evidence. Two exports of one plan have **different bytes**, so under content identity they are two
  ids. Plan grouping needs its own recorded field for the same reason facility does.
- **Migration** — the existing 300 catalogued drawings have path-derived ids. Whether they are
  re-identified by hash or left as they are, and how a record written under one scheme is read under
  the other, is a decision rather than a mechanical step.

**Not implemented here.** Flipping the derivation alone would leave the suite green and quietly
break D6 and D15 — which is the shape of defect this project's whole audit phase existed to remove.
Raised for decision on how facility and plan identity are carried once the id no longer carries
them.

## What the system cannot do yet — measured, not assumed

The new flow is defined; parts of it have no code path today. Stated so the run is attempted knowing
what exists.

| Step | Today |
| --- | --- |
| `sha256` of an uploaded file | ✅ `ingest-dataset.ts` computes it |
| PDF page count | ✅ detected from the document (`numPages`) |
| Per-page analysis | ✅ `verify:drawing --page N` / `--pages N,M`, recorded as `user-selected` |
| **Full-document analysis** | ✅ **implemented** — `--all-pages`, or simply no page argument. Every page analysed independently, one result each. Exercised on `Hospital_016/dialysis.pdf`, 7 pages |
| Out-of-range page | ✅ **refused**, never clamped — a third outcome that analyses nothing |
| **Generate a `drawingId` for a loose uploaded file** | ❌ built as `${hospitalId}/${basename}`; needs a hospital-shaped folder. No single-file ingest path, and D17 blocks on the `facilityOf` consequence above |

`--page` no longer defaults to `0`. That default made *"nobody chose"* and *"page 0"* the same
input, so a multi-page drawing was reported on its first page and the record could not say
afterwards whether anyone had picked it. The rule now lives in `scripts/lib/pageSelection.ts`, where
`pageSelection.test.ts` can break it — a page chosen by software and a page chosen by a person
produce identical-looking records, so this cannot be caught by reading output.

---

# History — the blockers under the previous input model

Retained rather than deleted; this project does not rewrite its own record.

## Former blocker 1 — the drawing identifier resolved to nothing

`Vantive_Layout_001`, Page 1 — matched **0** of the 300 drawings in `knowledge/dataset.json` and no
file under the dataset root. Every catalogued identifier has the shape `Hospital_NNN/<sheet>.<ext>`.

**No longer applicable in this form.** The user no longer supplies an identifier, so an identifier
cannot fail to resolve. The underlying requirement survives in a simpler shape: *the file itself must
exist*, and the system records its `sha256` before reading it.

## Former blocker 2 — the operator was not designated

Supplied as *영업/TS 담당자 — 실행 담당자 지정 필요*.

**No longer a blocker.** Operator is optional metadata. Absent is a valid state — and absent means
the key is omitted, not filled with a role name.

## Formerly flagged, now resolved by the decision

| Field | Then | Now |
| --- | --- | --- |
| Requester `Account Name` | Flagged as a placeholder | Optional. Omit if not supplied |
| Reviewing engineer `TS Team Supervisor` | Flagged as a role, not a person | Not an input at all. Named at confirmation, by the person signing |

---

## What has been recorded

- [`context.md`](context.md) — the human-provided context, verbatim
- This file

## What has **not** been done

- `run-metadata.json` — not created; no file has been uploaded
- `evidence/`, `result/` — empty; extraction has not been run
- `review/`, `confirmation/` — empty; human stages, never in machine scope

**PILOT-001 remains NOT EXECUTED.**
