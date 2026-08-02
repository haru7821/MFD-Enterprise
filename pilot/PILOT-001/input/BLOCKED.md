# PILOT-001 — input, and the blockers that preceded it

> **Resolved.** The drawing was supplied as `hospital044/Dialysis.pdf` and resolved to the
> catalogued `Hospital_044/dialysis.pdf` — exactly one candidate matched, case- and
> punctuation-insensitively. The resolution is recorded in `run-metadata.json` rather than applied
> silently, because the operator wrote a different string from the catalogued one.
>
> The machine stages have run. See [`../README.md`](../README.md).

## D17 is deferred — it does not block this pilot

> **Owner decision: do not start D17 identity migration.** It is a repository-wide architectural
> change, independent of Pilot-001, and provides no benefit to the first real engineering validation.
> It is scheduled as a separate milestone after the pilot completes and the first confirmation
> exists.

**In force until then:** the existing drawing identity model stays; the catalogue and corpus are not
regenerated; `rowFingerprint` is not invalidated; confirmation bindings are not modified.

So this pilot runs on catalogued, path-derived `drawingId`s exactly as the corpus already holds them.
Full record: [`../../../docs/decisions/IDENTITY_MIGRATION.md`](../../../docs/decisions/IDENTITY_MIGRATION.md).

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
| **Generate a `drawingId` for a loose uploaded file** | ❌ built as `${hospitalId}/${basename}`; needs a hospital-shaped folder. No single-file ingest path — **and D17, which would have replaced this, is deferred** |

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
