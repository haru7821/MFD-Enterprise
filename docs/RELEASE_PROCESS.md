# Release Process

> **VantiCAD Layout** · Evidence-First Layout Decision Support · TS Edition
>
> How a change becomes an internal release. Written for the **v1.0.0 internal release**, and
> intended to outlive it.

This document says what must be true before a version is declared, and in what order it is checked.
It does not declare one: see [§5](#5--current-state) for where v1.0.0 actually stands.

**Internal release only.** VantiCAD Layout is an internal engineering project used by Technical
Service engineers. There is no public distribution, and no licence is declared —
see the README's License section.

---

## 1 · Release Candidate requirements

A build is a **Release Candidate** when all of the following hold. Each is a statement someone can
check, not a judgement call.

| # | Requirement | Where it is recorded |
| --- | --- | --- |
| RC-1 | Every owner decision D1–D16 is recorded with the measurement that forced it | [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) §D |
| RC-2 | Every decision maps to a source location, a test, and a stated meaning of failure | [`release/REGRESSION_PROTECTION_MAP.md`](release/REGRESSION_PROTECTION_MAP.md) |
| RC-3 | Guards that **cannot** currently fail are listed, not silently counted | same, final table |
| RC-4 | The full validation set passes — [§2](#2--required-validation-commands) | run output |
| RC-5 | Committed artefacts regenerate byte-identically | `git status --porcelain knowledge/` empty |
| RC-6 | Schema versions, optional and nullable contracts and the export surface are stated | [`release/SCHEMA_FREEZE_CHECKLIST.md`](release/SCHEMA_FREEZE_CHECKLIST.md) |
| RC-7 | Known limitations are stated rather than omitted | [`release/RELEASE_READINESS_REPORT.md`](release/RELEASE_READINESS_REPORT.md) §9 |
| RC-8 | Open contract changes are named with their exposure and their fix | [`release/RELEASE_GATE.md`](release/RELEASE_GATE.md) §2 |

**A Release Candidate is not a release.** Passing RC-1…RC-8 establishes that the product is
internally coherent and that its claims are checkable. It does not establish that the product may
ship — that is [§4](#4--human-confirmation-requirement).

## 2 · Required validation commands

Run from the repository root, in this order. Later steps depend on earlier ones — `test:e2e` runs
against a production build, so `build` precedes it.

```bash
pnpm install                 # every workspace

pnpm typecheck               # every workspace, plus the e2e project
pnpm lint                    # every workspace
pnpm test                    # unit tests
pnpm build                   # production build → apps/web/dist
pnpm test:e2e                # browser specs against that build

# Artefact regeneration — must produce no diff
pnpm knowledge:extract
pnpm knowledge:build
pnpm validate:corpus
git status --porcelain knowledge/     # MUST be empty
```

**Every one of these must pass. A failure is a blocker, not a note.**

The last check is the one most easily skipped and the one that has actually caught drift: a commit
once changed an extractor's sort order without regenerating the artefacts, and the two disagreed for
two commits. Running the generators and diffing is what finds that; the suite alone does not.

### Determinism, beyond the default run

Byte-stability is a claim about *any* machine, so it is checked under locales that reorder strings:

```bash
for L in C sv_SE.UTF-8 tr_TR.UTF-8 ko_KR.UTF-8 de_DE.UTF-8; do
  LC_ALL=$L pnpm knowledge:build && git status --porcelain knowledge/
done
```

Any diff means locale-dependent ordering has entered the engine, and
`tests/architecture/determinism.test.ts` failed to catch it.

### What CI cannot do

The hospital drawings are the customer's property and live outside this repository, so CI cannot
re-measure anything from source drawings. What it verifies instead is that every committed record is
internally coherent — that a calibration follows from the dimension it names, and that nothing
claims agreement it has not demonstrated. Re-measurement is a human step against the dataset.

## 3 · Documentation verification

Documentation is part of the release, and its failure mode is specific: **a statement existing
before the evidence exists.** These checks exist because that has happened here repeatedly.

| Check | How |
| --- | --- |
| Every cited path, link and glob resolves | resolve each one; a broken citation is a broken claim |
| Every published figure re-derives independently | `figuresAreDerivable.test.ts` — deliberately **not** by calling the function that wrote the artefact |
| Test counts in documents match a real run | compare against `pnpm test` and `pnpm test:e2e --list` |
| No claim word exceeds its evidence | no *guaranteed*, *canonical*, *impossible*, *always*, *verified* without an executable proof named beside it |
| Positioning is consistent | evaluate · validate · document · explain. **Never** *design automatically*, *replace engineer*, *AI engineer*, *autonomous design*, *AI-powered*, *smart optimization*, *intelligent layout* |
| Superseded statements are marked, not deleted | this project does not rewrite its own record |
| Dormancy claims are measured with the right mutation | deleting a guard and reversing it are different tests; the weaker one flatters the code |

That last row is a real finding, not a hypothetical. A sort was documented as unkillable on the
evidence that *deleting* it left the suite green — reversing it fails two tests. A guard is dormant
only if **no** mutation of it can be caught.

## 4 · Human confirmation requirement

> **Production release requires at least one genuine human confirmation flowing through the D9–D12
> confirmation chain.**
>
> **Synthetic tests, fixtures, replay, or generated confirmations do not satisfy this requirement.**
>
> **The first real confirmation becomes the reference record for future regression.**

This is the blocking gate, stated in full in [`release/RELEASE_GATE.md`](release/RELEASE_GATE.md)
§3. It exists because **D7**: batch execution alone is not completion, and a machine reaching its
own last stage is not the programme being complete.

**Nothing inside this repository can satisfy it.** A confirmation is a person's statement that they
checked something. One produced by the engine, by a script, or by any agent in the development loop
to clear its own gate would be the system confirming itself — the exact failure the chain was built
to prevent, committed in the artefact built to prevent it.

The operational procedure for performing it is
[`PILOT_VALIDATION_PROCESS.md`](PILOT_VALIDATION_PROCESS.md), with a blank checklist at
[`pilot/PILOT-001-CHECKLIST.md`](pilot/PILOT-001-CHECKLIST.md).

**Procedure for the first confirmation**, recorded because the mechanism to *store* one exists while
no tool *authors* one:

1. Select a row from `knowledge/validation/corpus.json` and read the drawing it names against the
   discrepancy classification recorded for it.
2. Append an entry to `knowledge/validation/confirmations.json` carrying the row's outcome verbatim
   — `drawingId`, `page`, `sha256`, `reached`, `stoppedAt`, `discrepancies` — plus `kind`
   (`completion` or `stop`, **stated**, never inferred), `name`, an ISO-8601 `at` with offset in the
   signer's own timezone, and a `basis` naming what was checked against.
3. `pnpm validate:corpus` merges it and the count moves.

`kind` must be stated because signing the wrong one is a rejection rather than a silent
reclassification — a `completion` confirmation on a stopped row fails `confirmationSchema` in
`confirmations.json`'s own terms.

## 5 · Current state

**v1.0.0 is prepared, not declared.**

| Gate | State |
| --- | --- |
| RC-1…RC-8 | ✅ met |
| Validation set ([§2](#2--required-validation-commands)) | ✅ passing |
| Documentation verification ([§3](#3--documentation-verification)) | ✅ |
| Human confirmation ([§4](#4--human-confirmation-requirement)) | ❌ **not met** |

Measured: `confirmations.json` holds `[]`; of 306 corpus rows, **0** carry `confirmedBy` and **0**
carry `stopConfirmedBy`; all 306 stop — 211 at import, 80 at calibrate, 15 at room. No row is
currently eligible for a *completion* confirmation under D7, so the signable act today is a **stop**
confirmation under D12.

Two further things a version number would otherwise be read as settling, and does not:

- **Two open contract changes** — `knowledge/dataset.json` has no version field, and
  `Rejection.detail` has no schema. Neither blocks release; both are named in
  [`release/RELEASE_GATE.md`](release/RELEASE_GATE.md) §2.
- **A-1 remains unresolved.** Every clearance rule carries a `null` threshold, every clearance
  finding reads `RC-110`, every report verdict is **판정 불가 / Inconclusive**, and
  `compliance_margin` — 40 % of the scoring model — is unmeasurable on every real project. The
  product abstains correctly and says so; it cannot yet answer the question it exists to answer.
  **A version number does not change this, and must not be allowed to imply otherwise.**

## 6 · Declaring the version

Only once [§4](#4--human-confirmation-requirement) is met. In order:

1. Re-run [§2](#2--required-validation-commands) in full on a clean checkout.
2. Re-check [§3](#3--documentation-verification); update any figure that moved.
3. Update the state table in [§5](#5--current-state) and the verdict in
   [`release/RELEASE_GATE.md`](release/RELEASE_GATE.md).
4. Set the version in the workspace manifests. **This is a source change** and therefore outside a
   documentation commit — it is the step that makes the release, and it is deliberately last.
5. Tag, and record the tag against the commit the validation set was run on — not a later one.

If any step fails, the release does not proceed. There is no partial release: a version number is a
claim about the whole, and this project's standing rule is that a statement may not exist before its
evidence does.
