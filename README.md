# VantiCAD Layout

**Evidence-First Layout Decision Support**

> **VantiCAD Layout is not a CAD replacement. It is an engineering decision support engine that
> works alongside existing CAD workflows.**

VantiCAD Layout is an evidence-first layout decision support engine for Technical Service
engineers. Rather than searching for a single "best" layout, it evaluates measurable engineering
evidence, reports uncertainty explicitly, and provides deterministic, reproducible recommendations.

It assists Technical Service engineers in evaluating dialysis room layouts using measurable
engineering evidence. The engine never claims an ordering that the available evidence does not
support; when evidence is insufficient, it abstains explicitly and explains why.

An **internal engineering project**, not a public or generic CAD engine. It does not draw a
building; it judges a layout and states how far it can stand behind the judgement. Current product
scope is
[docs/product/MFD-E_TS_EDITION_SPEC.md](docs/product/MFD-E_TS_EDITION_SPEC.md); the repository
itself is still named `MFD-Enterprise`, and package identifiers remain `@mfd/*`.

---

## Philosophy

**The engine never claims an ordering that the evidence does not support.**

Everything below follows from that sentence, and from its consequence — that a system which cannot
tell *"I checked and it passed"* from *"I could not check"* will eventually tell an engineer the
second while sounding like the first. Nine of the ten defects found during this project's standing
audit were that single failure wearing different clothes.

So the engine distinguishes **three** states, never two: passed, failed, and **could not be
measured**. The third is carried explicitly, by reason code (`RC-9xx`, `SC-9xx`), all the way to the
screen. A criterion that could not be measured never becomes a zero, never renormalises out of a
total, and never ranks like a bad result.

Where implementation must choose between optimistic, inferred, approximate and abstaining
behaviour, it abstains. The goal is not to maximise PASS. It is to maximise **truthful** PASS.

**What that costs today**, stated here because leaving it out would break the rule above:
installation planning standards (A-1) have not been supplied, so every clearance rule carries a
`null` threshold, every clearance finding reads `RC-110`, and every report verdict is
**판정 불가 / Inconclusive**. `compliance_margin` — 40 % of the scoring model — is unmeasurable on
every real project. The engine abstains correctly and says so; it cannot yet answer the question it
exists to answer. Release status and the conditions for production are in
[docs/release/RELEASE_GATE.md](docs/release/RELEASE_GATE.md).

---

## Features

- **Geometry-aware candidate comparison** — candidates are compared by `geometryKey`: the exact
  equipment, position, rotation and mirroring of every placement. Exact, not hashed — at 32 bits a
  collision would merge two genuinely different layouts, and merging is the operation that destroys
  evidence. Candidates that are the same arrangement collapse into one proposal *before* scoring.
- **Evidence-based ranking** — a weighted score over a declared model, with the divisor fixed at the
  model's **whole** weight, so an unmeasured criterion contributes nothing and a score can only be
  earned. Below `minimumCoverage` (0.25) no total is offered at all — `null`, not zero.
- **Dense ranking with explicit ties** — proposals the evidence cannot separate share a rank number
  and are labelled **Tied / 동점**, never `#1` and `#2`. Tied means equal total *and* equal
  coverage; two unmeasurable layouts are exactly where claiming an order would assert what the
  engine cannot support.
- **Deterministic output** — the same evidence produces the same bytes, on any machine, on any
  re-run. No `localeCompare`, one declared clock boundary, no randomness; asserted by architecture
  tests and by a replay harness that shuffles inputs and compares outputs.
- **Explainable recommendations** — the solver emits **codes with parameters**, never prose. Every
  sentence an engineer reads is composed at render time from a rationale code, so an explanation
  cannot drift from the data it describes.
- **English / Korean explanations** — both rendered, never one as a fallback for the other. Korean
  particles are computed from the Hangul syllable (`(code - 0xAC00) % 28 !== 0`) rather than kept in
  a table, and the helper **abstains** — falling back to commas — for a word whose ending it cannot
  read, because a guessed particle is a mistake printed in front of an engineer.

---

## Example

Four dialysis stations in an 8,000 × 6,000 mm room with five service reference points. The output
below was produced by running the solver on the shipped fixture, not written by hand; the same case
is asserted in `packages/ai-local/src/rank.test.ts`.

### Input

```ts
rankLayouts({
  room:            [{x:0,y:0}, {x:8000,y:0}, {x:8000,y:6000}, {x:0,y:6000}],   // mm
  object:          fixtureMachine(),      // the dialysis station to place
  stationTarget:   4,
  pitchPadding:    1200,
  planStatus:      'calibrated',
  referencePoints: [
    { kind: 'ro_supply',        position: {x:    0, y:    0} },
    { kind: 'electrical_panel', position: {x: 8000, y:    0} },
    { kind: 'drain',            position: {x:    0, y: 6000} },
    { kind: 'access_entry',     position: {x: 4000, y:    0} },
    { kind: 'staff_base',       position: {x: 4000, y: 6000} },
  ],
  scoring: dialysisScoringModel,
})
```

↓

### Output

Three strategies generated candidates. `rows` and `perimeter` produced the **same arrangement**, so
they collapsed into one proposal that records both:

```jsonc
{
  "rank": 1, "tied": false,
  "candidateId": "perimeter-4-033p4n9",
  "strategies":  ["rows", "perimeter"],     // convergence kept, in canonical order (D16)
  "total": 0.283333333, "coverage": 0.4,
  "unavailable": ["compliance_margin:SC-904", "installation_feasibility:SC-905"],
  "compliance": { "violations": 0, "review": 8, "unevaluable": 0 }
}
{
  "rank": 2, "tied": false,
  "candidateId": "columns-4-0l767z9",
  "strategies":  ["columns"],
  "total": 0.280260417, "coverage": 0.4,
  "unavailable": ["compliance_margin:SC-904", "installation_feasibility:SC-905"],
  "compliance": { "violations": 0, "review": 8, "unevaluable": 0 }
}
```

Note what the engine **declines** to do. Two of the model's criteria could not be measured, so
`coverage` is 0.4 and each `unavailable` entry names *why*, in the criterion's own reason code:

- **`SC-904` — No Requirement To Compare.** `compliance_margin` cannot be computed because no
  applicable threshold exists to measure headroom above. That is A-1 reaching the score.
- **`SC-905` — No Observed Figure.** `installation_feasibility` needs a delivery allowance, and no
  figure for it has been observed in the drawing dataset. It replaced a 150 mm constant written
  into the solver — a planning assumption with nothing behind it.

Neither scores as a zero, and neither is quietly divided out of the total. The score that remains
is 40 % of the model, and `AR-402` below says so on screen.

**This fixture scores better than a real project can.** Its machine declares service clearances, so
`maintenance_access` (weight 0.15) is measurable here; the shipped AK98 record has all four sides
`null`, which makes three criteria unmeasurable rather than two — 0.75 of the model — and puts the
reachable coverage ceiling at exactly `minimumCoverage`, 0.25. The example is chosen to show the
ranking machinery working, not to represent what today's catalogue returns.

These two proposals are **not** tied — 0.2833 separates from 0.2803. The tie path is real and is
exercised where it actually occurs: `tests/e2e/layout.spec.ts` drives a room in which all three
proposals tie, and asserts the panel prints **Tied / 동점** instead of a ranking.

↓

### Explanation

```
AR-105  EN  Arranged 4 stations in one layout that the rows and perimeter strategies
            each produced independently.
        KO  4대를 배치했으며, 행 배열과 벽면 배열 방식이 각각 동일한 배열에 도달했습니다.

AR-401  EN  This improves future expansion and worsens RO piping.
        KO  증설 여유 항목이 개선되고 RO 배관 길이 항목이 저하되었습니다.

AR-402  EN  2 criteria could not be measured, so this score covers 40% of the model.
        KO  2개 항목을 측정할 수 없어 평가 모델의 40%만 반영된 점수입니다.
```

`AR-105` says *each produced independently* — not *"agreed"*, not *"converged"*, and never *"best"*,
*"winning"* or *"selected"*: the strategies do not confer, and their independence is the whole
evidential value of naming them. That forbidden vocabulary is asserted by test.

`AR-402` is the abstention, carried into the sentence the engineer reads rather than left in a field
nobody renders.

---

## Architecture

Nine packages under `packages/`, each independently testable, plus the web client:

```
document-model    the project file and its migrations    cad-engine       geometry, units, transforms
object-library    equipment catalogue                    rule-engine      rules → findings
ai-contract       scoring model, rationale codes         ai-local         candidates, scoring, ranking
ai-planner        installation planning                  report-engine    JSON / HTML / PDF
layout-knowledge  observations → derived knowledge       apps/web         React + Vite designer
```

The dependency rule is one-way and enforced by ESLint rather than by memory: `apps/` may import
`packages/`, never the reverse, and `packages/` may not import a UI framework, a renderer or a Node
built-in. `ai-local`, `document-model` and `rule-engine` are **pure and isomorphic** — no Node type
dependency at all, asserted by an architecture test.

Engineering values are never written in code. Search the rule engine for a millimetre figure and
there is not one: every number comes from a rule file under `standards/` or an equipment record, and
every finding cites which.

### Owner decisions D1–D16

The engineering semantics of this system are decisions, not defaults. Each is recorded with the
measurement that forced it in [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) §D, and each maps to
a guard in [docs/release/REGRESSION_PROTECTION_MAP.md](docs/release/REGRESSION_PROTECTION_MAP.md).

| | Decision |
| --- | --- |
| **D1** | No renormalised total. Below `minimumCoverage` 0.25 there is no total — `null`, not zero. Dividing by *available* weight meant deleting evidence raised the score, to a perfect 1.0000 at coverage 0.20. |
| **D2** | Touching is not collision — proper overlap only, one predicate for every subsystem. |
| **D3** | Clearance must see walls and obstructions, and **abstains** rather than reporting clear past one. |
| **D4** | `compliance_margin` is unavailable on a non-rectangular room (`SC-908`). No bounding-box approximation — it over-reported 9.6× on an L-shaped room. |
| **D5** | An unevaluable placement means the level cannot receive a PASS. |
| **D6** | Support counts **independent facilities**, not files. Measured: 117 files, 24 sites. |
| **D7** | Completion means a **human-confirmed** run. Batch execution alone is not completion. |
| **D8** | D4's rule extends to `maintenance_access`, ordered after the `SC-904` check so the reported reason stays one an engineer can act on. |
| **D9** | Confirmations live in a file **no batch writes**, so a re-run cannot destroy a signature. |
| **D10** | A confirmation binds to the run's **outcome**, not merely the file's bytes — it stops applying the moment the pipeline's reading changes. |
| **D11** | One confirmation applies; duplicates and stale ones are **reported, never deleted**. |
| **D12** | Confirming a stop is a **separate act** — separate field, separate count, never summed into completion. |
| **D13** | A tie is never presented as `#1`. Alphabetical order may not become engineering preference. |
| **D14** | No empty `frequencies` — omit the key. Unknown must not masquerade as measured zero. |
| **D15** | Support counts distinct **plans**, not files; the field is renamed `plans` rather than silently renumbered. |
| **D16** | `RankedLayout.strategies` is ordered as the sentence built from it is ordered. One fact, one order. |

### Documentation

| Document | Read it for |
| --- | --- |
| [docs/product/MFD-E_TS_EDITION_SPEC.md](docs/product/MFD-E_TS_EDITION_SPEC.md) | **What is being built now** — product definition, user, MVP scope |
| [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) | Owner decisions D1–D16, and **what is still needed from the owner** |
| [docs/release/RELEASE_GATE.md](docs/release/RELEASE_GATE.md) | Release Candidate → Production conditions, and the one not met |
| [docs/release/RELEASE_READINESS_REPORT.md](docs/release/RELEASE_READINESS_REPORT.md) | Evidence model, equality definitions, determinism, known limitations |
| [docs/release/REGRESSION_PROTECTION_MAP.md](docs/release/REGRESSION_PROTECTION_MAP.md) | Every decision → source → test → what a failure means |
| [docs/release/SCHEMA_FREEZE_CHECKLIST.md](docs/release/SCHEMA_FREEZE_CHECKLIST.md) | Version fields, optional and nullable contracts, export surface |
| [docs/data-model/PROJECT_MODEL.md](docs/data-model/PROJECT_MODEL.md) | Project · Level · Boundary · Space · Placement |
| [docs/data-model/OBJECT_MODEL.md](docs/data-model/OBJECT_MODEL.md) | Manufacturer dimensions vs design footprint, per-field verification |
| [docs/rules/DIALYSIS_RULE_ENGINE_v0.1.md](docs/rules/DIALYSIS_RULE_ENGINE_v0.1.md) | Rule categories, result levels, rule data structure |
| [docs/architecture/RULE_ENGINE_API.md](docs/architecture/RULE_ENGINE_API.md) | The frozen finding contract every consumer reads |
| [docs/architecture/AI_SYSTEM_ARCHITECTURE.md](docs/architecture/AI_SYSTEM_ARCHITECTURE.md) | Where the AI sits, and what it may not assert |
| [docs/architecture/PLATFORM_SUPPORT.md](docs/architecture/PLATFORM_SUPPORT.md) | Web-first: browsers, tablet, PWA — and what is **not** verified |
| [CLAUDE.md](CLAUDE.md) | Long-term direction, engineering principles, and the review loop |

---

## Build

Requires **Node.js ≥ 20.19** and **pnpm 10** (`npm install -g pnpm`).

```bash
pnpm install     # every workspace
pnpm dev         # designer at http://localhost:5173
pnpm build       # production build → apps/web/dist
```

| Command | What it does |
| --- | --- |
| `pnpm typecheck` · `pnpm lint` | Type-check · lint every workspace |
| `pnpm test` · `pnpm test:e2e` | Unit tests · browser specs against a production build |
| `pnpm bench` · `pnpm test:perf` | Rule-engine baseline · frame time — instruments, not gates |
| `pnpm dataset:ingest` | Catalogue the drawing dataset → `knowledge/dataset.json` |
| `pnpm knowledge:extract` | Drawings → `knowledge/observations/` |
| `pnpm knowledge:build` | Observations → `knowledge/derived/` |
| `pnpm verify:drawing` | Drive one drawing through the pipeline, recording where it stops |
| `pnpm validate:corpus` | The whole corpus → `knowledge/validation/corpus.json` |

The knowledge artefacts are committed and **regenerate byte-identically** — verified across `LC_ALL`
of C, sv_SE, tr_TR, ko_KR and de_DE. If a regeneration produces a diff, either the input changed or
a generator did; catching that is why they are committed.

---

## Tests

```
1327 unit   in 75 files    pnpm test
 156 e2e    in 12 files    pnpm test:e2e
```

Passing is the floor, not the standard. Guards here are verified by **mutation** — break the guard,
confirm the suite goes red — because this repository has shipped guards that could not fail, and a
green suite cannot tell the difference. Guards that currently cannot fail are listed rather than
quietly counted, in
[docs/release/REGRESSION_PROTECTION_MAP.md](docs/release/REGRESSION_PROTECTION_MAP.md), which gives
every decision a source, a test, and a statement of **what a failure of that guard means**.

Four architecture tests police what a unit test cannot see:

| | |
| --- | --- |
| `determinism.test.ts` | No `localeCompare`, one clock boundary, no randomness |
| `replay.test.ts` | Shuffled input, identical output |
| `everyTestIsCollected.test.ts` | No test file exists that never runs — indistinguishable from one that always passes |
| `artefactsMatchTheirGenerators.test.ts` | No committed artefact has drifted from the code that writes it |

---

## License

**No licence is currently declared.** There is no `LICENSE` file, no `license` field in any of the
ten `package.json` files, and every workspace is marked `private: true`.

Absent a declared licence, no rights are granted: this is **not** open source and should not be
treated as such. Saying so plainly is better than leaving the section blank, which reads as an
oversight rather than a position.

Choosing a licence — or confirming that the project stays proprietary — is an owner decision, and
not one the engineering loop may make on its own.
