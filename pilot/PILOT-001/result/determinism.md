# PILOT-001 · Deterministic result generation

Extraction stopped at `room`, so no evaluation, ranking or rationale was produced. There is no
`evaluation.json`, no `ranking.json` and no `rationale.md`, and their absence is the run's result
rather than a gap. What this file records is whether **the stop itself reproduces**.

## Re-runs

| Run | Conditions | Result |
| --- | --- | --- |
| 1 | Initial | stopped at `room` after `verify_mapping`; `VD-1`, `VD-4` |
| 2 | Same machine, same commit, re-run | **byte-identical** to run 1 |

The comparison is over the full console output, normalised only for the `--reason` string, which
differs by design between the two invocations and is not part of the finding.

`git status --porcelain knowledge/` was empty before run 1 and after every run.

## ❌ The locale sweep did NOT run — recorded as a failure, not a pass

Two further runs were attempted under `LC_ALL=tr_TR.UTF-8` and `LC_ALL=ko_KR.UTF-8`. Both produced
output identical to run 2 — **and that result is worthless**, because the locales are not installed
in this container:

```
$ locale -a
C
C.utf8
POSIX
```

`setlocale` failed for both, so the shell fell back and all four runs executed under the same
locale. **Nothing about locale independence was established here.**

This is written down rather than reported as three passing determinism checks, because that is
precisely the shape of false evidence this project exists to eliminate: a check that could not fail,
recorded as a check that passed. The command emitted a warning to stderr, and a run that only read
the exit status would have recorded a clean sweep.

**What this does not undermine:** locale independence of the *knowledge artefacts* is covered
separately by `tests/architecture/determinism.test.ts` (the static ban on `localeCompare`) and by the
byte-identity sweep recorded in the release documents, which ran where the locales exist. What is
missing is a locale sweep **of this pilot run specifically**, and it is missing because the
environment cannot provide one.

**For the reviewer:** treat cross-locale reproduction of this run as **not tested**, not as passed.
A second machine with the locales installed would close it.
