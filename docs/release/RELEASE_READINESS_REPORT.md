# Release Readiness Report

> **VantiCAD Layout** · Evidence-First Layout Decision Support

> Prepared at commit `cea0f54`, after the audit phase closed; revised at `7db2b16` after review.
>
> The first draft was documentation-only. The review of it rejected three claims, and the revision
> carries the code changes those findings and owner decision D16 required — an exported
> `compareLayouts` with tests that can break it, and one strategy order instead of two.
>
> Read with [`SCHEMA_FREEZE_CHECKLIST.md`](SCHEMA_FREEZE_CHECKLIST.md) and
> [`REGRESSION_PROTECTION_MAP.md`](REGRESSION_PROTECTION_MAP.md). The conditions for leaving Release
> Candidate — and the one that is not met — are in [`RELEASE_GATE.md`](RELEASE_GATE.md).

Every figure below was re-derived from the repository while writing this. Where something could not
be verified, it is in [§9](#9-known-intentional-limitations) rather than stated as fact.

---

## 1 · The evidence model

The product's governing rule, restated by the owner in every round:

> *"If something cannot honestly be measured, do not estimate it. Whenever implementation must
> choose between optimistic, inferred, approximate and abstaining behaviour — choose abstaining.
> The goal is never to maximise PASS. The goal is to maximise truthful PASS."*

Everything below is a consequence of that sentence rather than an independent design choice.

**The engine distinguishes three states, never two.** A check that passed, a check that failed, and
a check that could not be made. The third is the one this codebase kept losing: nine of the ten
defects the standing audit found were the same failure — the system could not tell *"I checked and
it passed"* from *"I could not check"*. Reason codes carry that distinction (`RC-9xx` and `SC-9xx`
are engine-cannot-answer), and `ReasonKind` drives the report verdict from it.

Decisions D1–D16 are recorded with their evidence in
[`docs/OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md) §D. That register exists because D1–D5 originally
lived only in commit messages, and a decision recorded only there is one the next reader meets as a
surprise.

---

## 2 · Equality definitions

Five equality concepts, none interchangeable. The full audit is in the Priority A report; this is the
contract.

| Concept | Means | Use it when |
| --- | --- | --- |
| `drawingId` | Identity of a drawing **entity** | Deciding whether two references point at the same drawing |
| `planOf(drawingId)` | The plan, ignoring export format | Comparing readings that belong to one sheet — collapses the `.dwg`/`.pdf` twins |
| `facilityOf(drawingId)` | The site | Counting independent evidence |
| `sha256` | The **bytes** | Proving a file is the one that was catalogued |
| `rowFingerprint(outcome)` | An extracted **record**, including the run's outcome | Deciding whether a signature applies to this run |
| `geometryKey(placements)` | The **arrangement** — equipment, position, rotation, mirroring | Deciding whether two candidates are the same layout |

**Support counts plans, not files** (D15). The corpus ships 75 plans in two export formats, so
counting `drawingId` reported `station_pitch` as **117** drawings of support over **71** actual
sheets. The field is named `plans` rather than silently renumbered, because a figure that keeps its
name while changing its value is this project's recurring failure.

**`geometryKey` is exact, not hashed.** `candidate.id` embeds a 32-bit position hash, which is fine
for naming a candidate and wrong for merging two: at 32 bits a collision merges two genuinely
different layouts, and merging is the operation that loses evidence.

---

## 3 · Ranking semantics

- `compareLayouts` orders by **total score**, then **compliance margin**, then **candidate id**.
- Ranks are **dense over the evidence**: two proposals the evidence cannot separate share a number.
- Below the scoring model's `minimumCoverage` (**0.25**) there is no total at all — `null`, not zero
  (D1). Dividing by the *available* weight meant deleting evidence raised the score, to a perfect
  1.0000 at coverage 0.20.
- The candidate-id key gives a **deterministic internal order**, which the owner's decision
  explicitly permits and explicitly forbids presenting as engineering significance.

**Two of the three comparator keys are dormant**, and this is stated rather than implied: the
compliance-margin key cannot fire while every rule threshold is null (A-1), and the id key is
redundant given that `candidates.ts` already emits in id order. Both are labelled in the code as
belt-and-braces rather than as load-bearing. See [§9](#9-known-intentional-limitations).

The **first** key — the null-total sentinel that puts a suppressed score last — was dormant too and
was not listed here until review broke it. It is now live: `compareLayouts` is exported and
`rank.test.ts` pins both the *unknown outranks everything* mutant and the subtler *unknown equals a
measured zero* one.

---

## 4 · Tie semantics

> Owner decision D13: *"Do not present a tie as '#1'. If two or more candidates are
> indistinguishable under the available evidence, they are tied. Never let alphabetical order become
> engineering preference."*

**Tied means equal `total` **and** equal `coverage`** — the two numbers the product actually
measured. Two `null` totals count as equal, deliberately: `null` is "not measurable", and two
unmeasurable layouts are precisely where claiming an order would assert what the engine cannot
support.

The panel shows **Tied / 동점** in place of `#N`, with the score and coverage beneath it.

The measurement that forced this, **and what re-measurement later did to it**: `perimeter` and
`rows` scored an identical 0.283333333 with `compliance_margin` unavailable on both, and the layout
shown as **#1** was chosen by `'p' < 'r'`. That is what prompted D13 — and it was afterwards found
to be a duplicate. `perimeter-4-033p4n9` and `rows-4-033p4n9` are the *same arrangement*, so the id
key was not choosing between two layouts; it was choosing which name to print on one. Once
`collapseByGeometry` landed, the two surviving geometries on that fixture are separated by score
(0.283333333 against 0.280260417) and nothing on it ties at all.

The decision stands on evidence that survived: **in the browser's room all three proposals tie**,
which is what `layout.spec.ts` asserts and what an engineer actually meets. The fixture figure is
recorded here as the retracted measurement it is, rather than left in place as the forcing evidence,
because a number that keeps its role after its basis dissolves is the exact failure this phase
exists to remove. The full re-measurement is in `rank.test.ts:421-440`.

**Tied is not the same as converged** — see §5. Before geometry deduplication this screen showed
three "tied alternatives" of which two were one layout.

---

## 5 · Geometry convergence

> Owner decision: *"Candidates with identical geometry evidence should collapse into one proposal …
> Tied means multiple distinct geometries have equivalent evidence, not multiple strategies
> generated the same geometry."*

`collapseByGeometry` merges candidates whose `geometryKey` matches, **before** scoring. The survivor
is the codepoint-first candidate id — computed rather than inherited, so a shuffled candidate stream
yields the same survivor.

**Convergence is kept, not discarded.** `RankedLayout.strategies` lists every strategy that produced
the surviving geometry. Two strategies independently reaching one arrangement says more about the
room than one strategy doing so, and throwing it away to fix a duplicate would trade one lost fact
for another.

---

## 6 · Explanation rules

Explanations are **codes with parameters**, composed per language at render time. The solver never
writes prose.

- One strategy → `AR-104`, naming it adverbially (*"in columns"*).
- Two or more → `AR-105`, naming them and saying each **produced the layout independently**. Not
  *"agreed"* or *"converged"*: the strategies do not confer, and that independence is the evidential
  value of saying it at all.
- Forbidden vocabulary, asserted by test: `best`, `winning`, `winner`, `primary`, `selected`.
- Strategy order is `CANDIDATE_STRATEGIES`' declared order via `compareStrategies` — **not** the
  candidate-id format it previously inherited by accident. As written this was true of the rendered
  sentence and false of `RankedLayout.strategies`, which sorted alphabetically: the array read
  `['perimeter', 'rows']` beside a sentence reading *"rows and perimeter"*. Owner decision **D16**
  settles it in favour of one order for both, on the ground that the array is the machine-readable
  form of the sentence rather than a second datum — so the coupling is deliberate, and adding a
  strategy reorders the public field along with the prose.
- A placeholder with no parameter is left **visible** as `{name}` rather than blanked. *"Arranged 12
  stations "* reads as clumsy prose somebody explains away; `{strategy}` reads as the defect it is.

The optimiser's `already_best` message says *"no arrangement … scores higher"* rather than *"yours
scores highest"*, because the comparison it rests on excludes only strictly-greater candidates — a
tie leaves the outcome unchanged.

---

## 7 · Localization rules

Every user-facing string is bilingual, Korean above English, and both are rendered — never one with
the other as a fallback.

**Korean particles are computed, not tabled.** `hasFinalConsonant` reads the 받침 out of the Hangul
syllable block (`(code - 0xAC00) % 28 !== 0`), so 벽면 배열**과** and 격자 배치**와** are both correct
without a list of names to maintain. In a list of three or more the particle attaches to the
**second-to-last** noun — *A, B와 C* — so the final item's ending is irrelevant.

For a word not ending in a Hangul syllable the helper returns `null` and the join falls back to
commas. That is an abstention, not a default: the particle for "perimeter" depends on how a reader
pronounces it, and a guessed particle is a mistake printed in front of an engineer.

---

## 8 · Determinism guarantees

**Claim: the same evidence produces the same artefact bytes, on any machine, on any re-run.**

Enforced by:

| Rule | Where |
| --- | --- |
| No `localeCompare` in any shipped source | `tests/architecture/determinism.test.ts` |
| Exactly **one** declared clock boundary (`apps/web/src/editor/clock.ts`), and no `Math.random` anywhere | same |
| Every tracked test file is actually collected by vitest | `tests/architecture/everyTestIsCollected.test.ts` |
| Committed observations are in the order their generator writes | `tests/architecture/artefactsMatchTheirGenerators.test.ts` |
| Shuffled inputs produce identical outputs | `tests/architecture/replay.test.ts` |

Verified for this release: `knowledge:build`, `knowledge:extract` and `validate:corpus` all
regenerate **byte-identically**, and the knowledge base is byte-identical under `LC_ALL` of C,
sv_SE, tr_TR, ko_KR and de_DE.

**One ordering dependency is deliberate**: `corpus.json`'s `drawings` array follows catalogue order,
so the artefact reads in the same sequence as the dataset. The replay test asserts `totals`,
`byStage` and `unapplied` are order-invariant and asserts `drawings` only by length, rather than
claiming an invariance it does not have.

---

## 9 · Known intentional limitations

Stated because a release that hides these is worse than one that ships with them.

### 9.1 · Blocking on evidence that does not exist yet

- **A-1a — installation planning standards.** Every clearance rule carries a `null` threshold, so
  every clearance finding reads `RC-110` and the report's verdict is **판정 불가 / Inconclusive**.
  `compliance_margin`, 40 % of the scoring model, is unmeasurable on every real project. This is the
  single blocker on the product's purpose.
- **Both catalogue objects declare all four `serviceClearance` sides `null`**, so
  `maintenance_access` abstains with `SC-904` on every real project too.

### 9.2 · Reach of the knowledge base

- All **183** observations in the corpus are `common_dimension`. Eight of the nine files in
  `knowledge/derived/` contain `entries: []` — because those kinds are never collected, not because
  nothing was found. Asserted by test so the day it changes, something says so.
- **0 of 306** drawing-pages complete the validation programme; all 306 stop, 211 at import.

### 9.3 · Mechanisms that exist but have never run on real data

- **The confirmation chain (D9–D12) is fixture-only.** `confirmations.json` ships empty, so no guard
  in it has seen a real signature. The GM has escalated to the owner the one thing that would change
  that: a first genuine stop-confirmation is a person's act, and neither the GM nor the lead
  developer can author one.
- **`AR-301` and `AR-303`** carry counts of discarded candidates and were not produced in any
  configuration probed; no test in the repository asserts a non-empty `rejected`.
- **`frequenciesOf` is unreachable in production** — the one populated kind passes a literal `[]`,
  and every kind that calls it has no observations.

### 9.4 · Guards that are dormant or redundant, and why they are kept

- **`compare`'s margin key** and `marginOf`'s `-1` fallback cannot fire while margins are
  unmeasurable. A test fails the day A-1 supplies a threshold, which makes the dormancy visible
  rather than silent.
- **`compare`'s candidate-id key** is redundant given `candidates.ts` emits in id order and
  `Array.sort` is stable. Kept as belt-and-braces on an invariant another module maintains.
- **`ordered()` and `drawingsOf`'s sort are mutually redundant** — deleting either alone leaves the
  suite green; deleting both fails five tests. The pair is load-bearing, neither is alone, and this
  is written into `aggregate.ts` so a future reader deleting "the obviously duplicated sort" learns
  the other is then holding it up by itself.
- **`compare`'s null-total sentinel is no longer in this list, and the correction is the point.**
  It was not listed at all, and it should have been: changing `?? -1` to `?? 2` — the exact
  inversion of D1, promoting an *unscored* layout above every scored one — left all 1,322 tests
  green. Nothing reached it, because a null total needs coverage below `minimumCoverage` and the
  fixtures put every candidate on the same side of that threshold. It is now pinned by
  `rank.test.ts`, including the sharper mutant `?? 0`, which the first three cases did **not** kill:
  it makes *unknown* and *measured zero* indistinguishable, so the panel prints **Tied** over two
  layouts of which one was measured and one was not.

### 9.5 · A latent contradiction, unreachable today

`drain_routing` carries **weight 0** — deliberately and documented, so it is visible and can be
weighted by editing one file. The consequence is that `coverage` (weight-based) and
`unavailable.length` (criterion-count) have different denominators. Enumerating all 2⁸ subsets of the
scoring model: exactly one produces *"1 criteria could not be measured, so this score covers 100 % of
the model."* It is unreachable while `compliance_margin` is always unavailable. Recorded rather than
reworded, because the wording is not wrong today and the model may change.

### 9.6 · Verification that cannot run in CI

The drawings are a hospital's property and live outside this repository, so CI cannot re-measure
anything. What it can do — and does — is check that every committed record is internally coherent:
that the calibration follows from the dimension it names, and that nothing claims agreement it has
not demonstrated.

---

## 10 · Verification run for this report

| Check | Result |
| --- | --- |
| Unit tests | **1,327** in **75** files |
| Browser specs | **156** |
| `pnpm typecheck` | clean |
| `pnpm lint` | clean |
| `pnpm build` | succeeds |
| `pnpm knowledge:build` · `knowledge:extract` · `validate:corpus` | all regenerate byte-identically |
