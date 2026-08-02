# Release Gate — Release Candidate → Production

> The conditions required to move this product from Release Candidate to Production, at commit
> `43e226a`.
>
> Companion to [`RELEASE_READINESS_REPORT.md`](RELEASE_READINESS_REPORT.md),
> [`SCHEMA_FREEZE_CHECKLIST.md`](SCHEMA_FREEZE_CHECKLIST.md) and
> [`REGRESSION_PROTECTION_MAP.md`](REGRESSION_PROTECTION_MAP.md).

A gate that only lists what passed is a certificate, not a gate. The section that decides whether
this product ships is [§3](#3--operational-blocking-gate), and it is currently **not met**.

| Section | State |
| --- | --- |
| 1 · Passed gates | ✅ 6 of 6 |
| 2 · Open contract changes | ⚠️ 2 open — both deferred deliberately, neither blocking |
| 3 · Operational blocking gate | ❌ **not met** — no human confirmation exists |

**Verdict: Release Candidate. Not cleared for Production.**

---

## 1 · Passed gates

Each row states what was verified and by what. "Passed" here means *a guard exists, it is reachable,
and breaking it turns the suite red* — the standard this project arrived at after finding guards
that could not fail.

### 1.1 · Evidence integrity ✅

The engine distinguishes three states — passed, failed, and **could not be measured** — and never
collapses the third into either of the others.

| Verified | By |
| --- | --- |
| No renormalised total; ranking suppressed below `minimumCoverage` 0.25 (D1) | `score.test.ts`; ordering pinned by `rank.test.ts` |
| A suppressed total is neither a zero nor a best answer (D1) | `rank.test.ts` — both the `?? 2` and `?? 0` mutants fail |
| Clearance abstains rather than reporting clear past a wall (D3) | `boundary.test.ts` |
| `compliance_margin` and `maintenance_access` abstain on a non-rectangular room (D4/D8) | `score.test.ts` |
| An unevaluable placement makes the level Inconclusive (D5) | `result.shape.test.ts` |
| Containment, collision and clearance answer only their own question | `independence.test.ts` |
| Unknown never becomes a measured zero | `messages.test.ts`, `result.shape.test.ts` |

### 1.2 · Equality model ✅

Six equality concepts, none interchangeable, each with one definition and one implementation:
`drawingId` (entity), `planOf` (plan family), `facilityOf` (site), `sha256` (bytes),
`rowFingerprint` (extracted record **including the run's outcome**), `geometryKey` (arrangement).

| Verified | By |
| --- | --- |
| Touching is not collision; one predicate across subsystems (D2) | `polygon.test.ts`, `sat.test.ts` |
| Support counts independent facilities (D6) and distinct plans, not files (D15) | `knowledge.test.ts`, `boundaries.test.ts` |
| `rowFingerprint` is injective — no delimiter collision | `corpusLedger.test.ts` |
| Identical placements collapse to one proposal (`geometryKey`) | `rank.test.ts` Cases A/B/C |

### 1.3 · Ranking semantics ✅

| Verified | By |
| --- | --- |
| Ties are shown as **Tied / 동점**, never as `#1` (D13) | `rank.test.ts`, `layout.spec.ts` |
| Converged strategies collapse and the convergence is preserved | `rank.test.ts` Case A |
| `strategies` and the `AR-105` sentence carry one order (D16) | `rank.test.ts` Cases A and B |
| `already_best` claims only what it compared | `optimise.test.ts`, `layout.spec.ts` |
| The optimiser never proposes deleting a machine | `optimise.test.ts` |

### 1.4 · Determinism ✅

| Verified | By |
| --- | --- |
| No `localeCompare`; one declared clock boundary; no randomness | `determinism.test.ts` |
| Shuffled input, identical output | `replay.test.ts` |
| Every tracked test file is actually collected | `everyTestIsCollected.test.ts` |
| Committed artefacts match their generators | `artefactsMatchTheirGenerators.test.ts` |
| `knowledge:extract` · `knowledge:build` · `validate:corpus` regenerate byte-identically | re-run at `43e226a`; `git status --porcelain knowledge/` empty |
| Byte-identical across locales | `LC_ALL` of C, sv_SE, tr_TR, ko_KR, de_DE |

### 1.5 · Documentation ✅

| Verified | By |
| --- | --- |
| Every owner decision D1–D16 recorded with its evidence | `docs/OPEN_QUESTIONS.md` §D |
| Every published figure re-derives independently of the code that wrote it | `figuresAreDerivable.test.ts` |
| Every figure cites a catalogued drawing | same |
| Release documents' path citations resolve | checked at `43e226a` |

### 1.6 · Regression protection ✅

Every decision above maps to a source location, a test, and a stated meaning of failure, in
[`REGRESSION_PROTECTION_MAP.md`](REGRESSION_PROTECTION_MAP.md). Guards that **cannot currently
fail** are listed there too, because a map that omitted them would overstate its own coverage.

Suite at this commit: **1,327** unit tests in **75** files, **156** browser specs; typecheck, lint
and build clean.

---

## 2 · Open contract changes

Both are deferred deliberately, both are recorded rather than discovered, and **neither blocks
Production**. Each is a schema change, and each should land with the next contract-touching commit
rather than as a lone edit to a frozen surface.

### 2.1 · `knowledge/dataset.json` has no version field

It has a schema (`datasetSchema`), it is a committed artefact, and **every other artefact resolves
its `drawingId` against it** — `support.sources`, every corpus row, every observation. It is the
only governed artefact without a version.

- **Exposure today:** low. The file is regenerated by `pnpm dataset:ingest` from the dataset itself.
- **Cost of leaving it:** a shape without a version is a shape nobody can refuse. `KNOWLEDGE_VERSION`
  was bumped twice during the audit for exactly this reason.
- **Fix:** add the field, add the literal to `datasetSchema`, regenerate.

### 2.2 · `Rejection.detail` has no schema

`packages/ai-local/src/gates.ts:47-69`. Seven properties, **all optional**, so the type permits
`detail: {}`, and no zod schema validates it at any boundary — it is a bare TypeScript interface.

`Rejection` reaches the public surface by three routes, and they are not equally covered. This was
first written here as *"no schema, no test, a UI consumer branching on it"*; checking each clause
individually contradicted two of the three, so the accurate version is:

| Route | Tested |
| --- | --- |
| `GateOutcome.violations` | ✅ `gates.test.ts` asserts `ruleId`, `reasonCode`, `placementIds`, `reasonParams` |
| `OptimiseResult.blocking` | ✅ `optimise.test.ts:384,392,455` |
| `RankResult.rejected` (via `RejectedCandidate.rejection`) | ❌ no test asserts a non-empty `rejected` at all |

The consumer is `runSolver.ts:166-174`, reading `violation.detail` off **`blocking`** — not
`rejected`, and not at line 88, which only reads `rejected.length` to choose between two messages.

**The sharper risk is the one the optionality creates at that consumer**, and it is not a missing
test: `runSolver.ts` reads `violation.detail.ruleId ?? ''` and `placementIds ?? []`. An absent
`ruleId` therefore renders as an **empty string** in the panel rather than as an absence — the
product's standing failure mode, unknown presented as a measured value, in the one place where the
type system permits it. Nothing today produces a `Rejection` without a `ruleId`; nothing prevents
it either.

- **Fix:** a zod schema marking the genuinely-optional fields and requiring the rest, so the empty
  case cannot reach the panel; plus one test asserting a populated `rejected`.

---

## 3 · Operational blocking gate

> **Production release requires at least one genuine human confirmation flowing through the D9–D12
> confirmation chain.**
>
> **Synthetic tests, fixtures, replay, or generated confirmations do not satisfy this requirement.**
>
> **The first real confirmation becomes the reference record for future regression.**

### 3.1 · Current state — measured at `43e226a`

```
knowledge/validation/confirmations.json   { "version": 2, "confirmations": [] }

knowledge/validation/corpus.json          drawings        306
                                          completed         0
                                          batchComplete     0
                                          stopped         306
                                          stopsConfirmed    0
                                          unapplied         0
```

Rows carrying `confirmedBy`: **0**. Rows carrying `stopConfirmedBy`: **0**.

All 306 pages stop — 211 at `import`, 80 at `calibrate`, 15 at `room`. Under D7's rule
(`completed` requires `stoppedAt === null` **and** a confirmation) nothing in the corpus is even
*eligible* for a completion confirmation today. The signable act available now is a **stop
confirmation** under D12: a person stating *"this sheet genuinely carries no dimension set a scale
can be established from, and the classification recorded against it is correct."*

### 3.2 · Why this gate exists and why nothing internal can clear it

D7 was written because a machine reaching its own last stage was being recorded as the programme
being complete. D9–D12 are the mechanism that keeps that distinction real:

| | |
| --- | --- |
| **D9** | Confirmations live in `confirmations.json`, which no batch writes, so a re-run cannot destroy a signature |
| **D10** | A confirmation binds to the run's **outcome** via `rowFingerprint`, so it stops applying the moment the pipeline's reading changes |
| **D11** | A duplicate is reported, never dropped; a stale one is retained, never deleted |
| **D12** | Confirming a stop is a separate act with a separate field and a separate count, never summed into completion |

**Every one of these has been exercised only against fixtures.** The schemas parse, the refine rules
reject what they should, `corpusLedger.test.ts` covers merge, stale and duplicate — and no guard in
the chain has ever seen a signature a person actually gave. That is precisely the gap this gate
names: the mechanism is verified, the *act* is not, and the act is the thing D7 says completion
means.

**Neither the lead developer, the CTO agent nor the GM agent can satisfy this.** A confirmation is a
person's statement that they checked something. Any confirmation produced by this system to clear
its own gate would be the system confirming itself — the exact failure the whole chain was built to
prevent, committed in the artefact built to prevent it. This is escalated to the real owner and
stays there.

### 3.3 · What "genuine" excludes, explicitly

Not accepted as satisfying this gate:

- a confirmation authored by any agent in this repository's loop, on anyone's behalf;
- a fixture confirmation, including any already present in `verification.test.ts` or
  `corpusLedger.test.ts`;
- a confirmation generated, derived or back-filled from the ledger's own contents;
- a replayed, copied or migrated confirmation from an earlier schema version;
- a placeholder entered to make `stopsConfirmed` non-zero.

The distinction is not the file's syntax — every item above would parse. It is whether a person
looked at the drawing and the row and then signed. Nothing in the artefact can prove that, which is
why it is a gate on the release rather than a rule in a schema.

### 3.4 · What a first confirmation requires, procedurally

Recorded because the mechanism to *store* a confirmation exists while no tool *authors* one — the
first is hand-written JSON, and that is itself an operational readiness gap rather than a defect.

1. A person selects a stopped row from `knowledge/validation/corpus.json` and reads the drawing it
   names against the discrepancy classification recorded for it.
2. They append an entry to `knowledge/validation/confirmations.json` carrying the row's outcome
   verbatim — `drawingId`, `page`, `sha256`, `reached`, `stoppedAt`, `discrepancies` — plus
   `kind: "stop"`, their `name`, an ISO-8601 `at` **with offset**, in their own timezone, and a
   `basis` naming what they checked against.
3. `pnpm validate:corpus` merges it. `stopsConfirmed` becomes 1.
4. The chain is then live against real data: D10's binding will drop that signature the moment the
   pipeline's reading of that page changes, and that is the behaviour nobody has yet observed
   outside a fixture.

`kind` must be stated, not inferred — signing the wrong kind is a rejection, not a silent
reclassification. A `completion` confirmation on a stopped row fails `confirmationSchema`'s own
refine rule, in `confirmations.json`'s terms rather than by blaming the generated ledger.

### 3.5 · The reference record

The first genuine confirmation **becomes the reference record for future regression.** Concretely,
once it exists:

- it is committed to `knowledge/validation/confirmations.json` and never regenerated;
- it becomes the first non-fixture case for the D9–D12 guards, and the map row for each of them
  stops resting on constructed data;
- a change that would have invalidated it is a change the chain must be shown to catch — the record
  is what future regression is measured *against*, not merely an entry that happens to be present;
- `stopsConfirmed: 1` is the first number in the ledger that a batch could not have produced.

Until then, D9–D12 stay in
[`RELEASE_READINESS_REPORT.md`](RELEASE_READINESS_REPORT.md) §9.3 — *mechanisms that exist but have
never run on real data*.

---

## 4 · What passing this gate would not establish

Stated so §1's six ticks are not read as more than they are.

**A-1 — installation planning standards — remains unresolved, and it is the single blocker on the
product's purpose.** Every clearance rule carries a `null` threshold, so every clearance finding
reads `RC-110`, every report verdict is **판정 불가 / Inconclusive**, and `compliance_margin` — 40 %
of the scoring model — is unmeasurable on every real project. Both catalogue objects declare all
four `serviceClearance` sides `null`, so `maintenance_access` abstains too.

The gates in §1 verify that the product **abstains correctly and says so**. They do not establish
that it can yet answer the engineering question it exists to answer. Clearing §2 and §3 makes this
product correct and honest in production; it does not make it useful without A-1.
