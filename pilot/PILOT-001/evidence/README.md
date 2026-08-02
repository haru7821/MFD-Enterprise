# evidence/ — what the engine extracted

Written by `pnpm verify:drawing`. Validates **evidence extraction**: whether the engine reads what
an engineer reads, and where it cannot, whether it stops and says so rather than producing a
plausible number.

| File | Contents | Required |
| --- | --- | --- |
| `verification-record.json` | The record written by `verify:drawing`, verbatim | **Yes** |
| `extraction-log.txt` | Console output of the run, unedited | **Yes** |
| `stop-analysis.md` | The stage it stopped at, its classification, and whether that matches what the drawing actually shows | **Yes** |

## A stop is a valid outcome

All 306 corpus rows currently stop — 211 at import, 80 at calibrate, 15 at room understanding. A
run that stops is the engine correctly declining to proceed on evidence it does not have.

`stop-analysis.md` exists for the harder question: **did it stop for the reason a person would
give?** A stop at the right stage for the wrong reason is a defect, and it is invisible in the counts.
