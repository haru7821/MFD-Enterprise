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

## One open decision before step 2

**How a generated `drawingId` is derived.** It is one of the project's six equality concepts — it
identifies a drawing *entity* — so the derivation decides what "the same drawing" means. Deriving
from `sha256` keeps it coherent with the bytes-equality concept and cannot mint a second identity
for a file already catalogued; deriving from an upload event would count one drawing twice, which
matters because support is counted per plan and per facility (D6, D15).

Options and their consequences are in
[`../../../docs/PILOT_VALIDATION_PROCESS.md`](../../../docs/PILOT_VALIDATION_PROCESS.md) §2. It is
the owner's decision and is not settled here.

## What the system cannot do yet — measured, not assumed

The new flow is defined; parts of it have no code path today. Stated so the run is attempted knowing
what exists.

| Step | Today |
| --- | --- |
| `sha256` of an uploaded file | ✅ `ingest-dataset.ts` computes it |
| PDF page count | ✅ detected from the document (`numPages`) |
| Per-page analysis | ✅ `verify:drawing --drawing <id> --page <n>`, page defaults to `0` |
| **Generate a `drawingId` for a loose uploaded file** | ❌ `drawingId` is built as `${hospitalId}/${basename}` — it needs a hospital-shaped folder. There is **no single-file ingest path** |
| **Full-document analysis** | ❌ no wrapper loops the pages; each page is a separate invocation today |

Both gaps are source changes and are outside the documentation scope this was prepared under.

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
