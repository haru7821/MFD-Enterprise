# Pilot runs

> **VantiCAD Layout** · Evidence-First Layout Decision Support · TS Edition

This directory holds **run artefacts** — what actually happened when the engine was pointed at a
real drawing and a real engineer reviewed the result.

It is deliberately separate from `docs/`:

| | Holds | Changes when |
| --- | --- | --- |
| `docs/PILOT_VALIDATION_PROCESS.md` | The **procedure** — what a pilot validates and why | The process is revised |
| `docs/pilot/PILOT-001-CHECKLIST.md` | The **blank template** | The checklist is revised |
| `pilot/PILOT-00N/` | The **record of one run** | Never, once the run is complete |

A run record is evidence. Once written it is not regenerated, not tidied and not back-filled — the
same rule the confirmation ledger lives under, and for the same reason.

## Rules for everything in this directory

- **No synthetic data.** Nothing here may be invented, generated as an example, or copied from a
  fixture. A file that does not describe a real run must not exist.
- **Empty is a valid state.** A folder with only its `README.md` means that stage has not happened.
  That is information, not an omission to be filled.
- **A run is not complete until a real engineer has reviewed it.** Machine stages finishing is not
  the pilot finishing — that distinction is owner decision D7, and it is the thing being validated.

## Runs

| Run | Status |
| --- | --- |
| [`PILOT-001`](PILOT-001/) | **Not executed** — structure prepared, awaiting a drawing and an operator |
