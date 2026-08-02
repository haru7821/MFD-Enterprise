# Engineering Principles

> **VantiCAD Layout** · Evidence-First Layout Decision Support · TS Edition

The rules this engine is built to, and the guard behind each one. A principle with no guard is a
preference, so every section below names what fails when the principle is broken.

## The four

1. **Never claim more than the evidence supports.**
2. **Prefer abstaining over guessing.**
3. **Every recommendation must be reproducible.**
4. **Engineering judgement remains with the engineer.**

**VantiCAD Layout evaluates, validates, documents and explains.** It is not a CAD replacement, not
an autonomous design system, and not a replacement for engineering judgement.

---

## 1 · Evidence-first decision making

The engine distinguishes **three** states, never two: a check that passed, a check that failed, and
a check that **could not be made**. The third is the one this codebase repeatedly lost, and nine of
the ten defects the standing audit found were that single failure — the system could not tell
*"I checked and it passed"* from *"I could not check"*.

That distinction is carried by reason code, not by convention: `RC-9xx` and `SC-9xx` mean
*engine-cannot-answer*, and `ReasonKind` drives the report verdict from it. An unmeasurable
criterion never becomes a zero, never renormalises out of a total, and never ranks like a bad
result.

The scoring divisor is the model's **whole** weight. Dividing by the *available* weight meant
deleting evidence raised the score — measured at a perfect 1.0000 on coverage 0.20.

| Guard | Fails when |
| --- | --- |
| `score.test.ts` | A total is offered that rests on absent evidence |
| `messages.test.ts`, `result.shape.test.ts` | An unmeasured criterion scores like a measured bad one |

## 2 · Equality definitions

Six equality concepts, none interchangeable. Using the wrong one is how a count of files became a
count of evidence.

| Concept | Means | Use it when |
| --- | --- | --- |
| `drawingId` | A drawing **entity** | Deciding whether two references are the same drawing |
| `planOf(drawingId)` | The plan, ignoring export format | Comparing readings belonging to one sheet |
| `facilityOf(drawingId)` | The **site** | Counting independent evidence |
| `sha256` | The **bytes** | Proving a file is the one catalogued |
| `rowFingerprint(outcome)` | An extracted **record**, including the run's outcome | Deciding whether a signature applies to this run |
| `geometryKey(placements)` | The **arrangement** | Deciding whether two candidates are the same layout |

Support counts **independent facilities** (D6) and **distinct plans** (D15), never files. Measured:
`station_pitch` claimed 117 drawings of support over 71 sheets and 24 sites.

`geometryKey` is **exact, not hashed**. `candidate.id` embeds a 32-bit position hash, which is fine
for naming a candidate and wrong for merging two — at 32 bits a collision merges two genuinely
different layouts, and merging is the operation that destroys evidence.

| Guard | Fails when |
| --- | --- |
| `knowledge.test.ts`, `boundaries.test.ts` | One firm's template reads as a consensus |
| `corpusLedger.test.ts` | A signature applies to a run it was not given for |
| `rank.test.ts` Cases A/B/C | Two identical arrangements are presented as alternatives |

## 3 · Ranking semantics

`compareLayouts` orders by **total score**, then **compliance margin**, then **candidate id**. Ranks
are **dense over the evidence**: proposals the evidence cannot separate share a number.

Below `minimumCoverage` (**0.25**) there is no total at all — `null`, not zero (D1). A suppressed
total sorts **last**, and is not a zero: an engine that ranked *"could not measure"* level with a
layout that genuinely scored 0 would be presenting unknown as a measurement.

The candidate-id key gives a deterministic internal order, which is permitted and **must never be
presented as engineering significance**.

| Guard | Fails when |
| --- | --- |
| `rank.test.ts` (`compareLayouts`) | Unknown outranks a scored layout, or ties with a measured zero |

## 4 · Tie handling

> **D13** — a tie is never presented as `#1`.

**Tied means equal `total` and equal `coverage`** — the two numbers the product actually measured.
Two `null` totals count as equal deliberately: `null` is *not measurable*, and two unmeasurable
layouts are precisely where claiming an order asserts what the engine cannot support.

The panel shows **Tied / 동점** in place of `#N`, with the score and coverage beneath it.

**Tied is not the same as converged.** Candidates with identical geometry collapse into one proposal
*before* scoring, and the convergence is preserved in `RankedLayout.strategies` rather than
discarded. Two strategies independently reaching one arrangement says more about the room than one
strategy doing so. Before that collapse existed, this screen showed three "tied alternatives" of
which two were one layout.

| Guard | Fails when |
| --- | --- |
| `rank.test.ts`, `layout.spec.ts` | Alphabetical order is presented as engineering preference |

## 5 · Determinism requirements

**The same evidence produces the same bytes, on any machine, on any re-run.**

- No `localeCompare` in shipped code — ordering is by codepoint. Measured cost of the alternative:
  171 changed lines in a committed artefact under a different locale.
- Exactly **one** declared clock boundary, and no randomness anywhere.
- Committed knowledge artefacts regenerate byte-identically, verified under `LC_ALL` of C, sv_SE,
  tr_TR, ko_KR and de_DE.

Static bans cannot see the failure this project actually shipped twice — a `Map` whose iteration
order is its insertion order, feeding a result nobody re-sorted. So determinism is also tested
empirically: shuffle the inputs, compare the outputs.

| Guard | Fails when |
| --- | --- |
| `determinism.test.ts` | A locale, a clock or a dice roll enters the engine |
| `replay.test.ts` | A `Map`'s insertion order reaches an engineer |
| `artefactsMatchTheirGenerators.test.ts` | A committed artefact drifts from the code that writes it |
| `everyTestIsCollected.test.ts` | A test file exists that never runs |

## 6 · Abstention rules

> *"If something cannot honestly be measured, do not estimate it."*

Where implementation must choose between optimistic, inferred, approximate and abstaining
behaviour, **it abstains**. The goal is not to maximise PASS; it is to maximise **truthful** PASS.

Abstention is never silent. Every abstention carries a code that says *which* measurement could not
be taken and *why*, so the engineer knows what to supply:

| Code | Means |
| --- | --- |
| `RC-110` | No requirement to compare against — no threshold has been supplied |
| `SC-904` | No applicable threshold exists to measure headroom above |
| `SC-905` | No figure for it has been observed in the drawing dataset |
| `SC-908` | The room is not axis-aligned rectangular; no bounding-box substitute is used |
| `RC-903` / `RC-904` | A placement could not be evaluated, so neighbouring passes are withdrawn |

Concrete refusals, each measured rather than assumed: clearance abstains rather than reporting clear
past a wall it cannot measure (D3); `compliance_margin` abstains on a non-rectangular room rather
than using its bounding box, which over-reported **9.6×** on an L-shaped room (D4); an unevaluable
placement means the level cannot receive a PASS (D5).

**Unknown must never masquerade as measured zero.** An empty `frequencies` array meant *"no
observations exist"* and *"this kind never collects frequencies"* at the same time, so the key is
omitted entirely rather than emitted empty (D14).

## 7 · Explanation consistency

The solver emits **codes with parameters**, never prose. Every sentence an engineer reads is
composed per language at render time, so an explanation cannot drift from the data it describes.

- Both languages are always rendered — never one with the other as a fallback.
- Korean particles are **computed** from the Hangul syllable (`(code - 0xAC00) % 28 !== 0`), not
  tabled; where the helper cannot read a word's ending it **abstains** and falls back to commas,
  because a guessed particle is a mistake printed in front of an engineer.
- Strategy order is `CANDIDATE_STRATEGIES`' declared order, and `RankedLayout.strategies` carries
  the **same** order as the sentence built from it (D16) — one fact, one order.
- A placeholder with no parameter is left **visible** as `{name}` rather than blanked: clumsy prose
  gets explained away, a bare `{strategy}` reads as the defect it is.
- Forbidden vocabulary, asserted by test: `best`, `winning`, `winner`, `primary`, `selected`.
  `AR-105` says strategies *each produced the layout independently* — not *agreed*, not *converged*.
  They do not confer, and that independence is the evidential value of naming them.

| Guard | Fails when |
| --- | --- |
| `rank.test.ts` Cases A/B/C, `korean.test.ts` | An explanation names one strategy and drops the others, or takes a wrong particle |
| `messages.test.ts`, `layout.spec.ts` | A language is missing, or a claim word exceeds the evidence |

## 8 · The human judgement boundary

**This is the principle the other seven serve.**

The engine proposes, explains, retrieves and summarises. The rule engine judges. The report states.
**A person decides.** Nothing the engine emits is a decision, and no future capability may be
described as if it were.

In practice:

- The optimiser returns **commands an engineer could have issued** — reviewable and undoable like
  anyone else's work — rather than applying changes.
- It never proposes `placement.delete`: improving a score by removing a machine the hospital asked
  for is not an engineering improvement.
- `already_best` says *"no arrangement the solver can construct at this station count scores
  higher"*, not *"yours scores highest"* — the comparison it rests on excludes only strictly-greater
  candidates, so a tie leaves the outcome unchanged.
- **A batch run is not a conclusion** (D7). Completion means a human-confirmed run; a machine
  reaching its own last stage is not the programme being complete. Confirmations live in a file no
  batch writes (D9), bind to the run's outcome (D10), and are reported rather than discarded when
  stale or duplicated (D11). Confirming a stop is a separate act from confirming completion (D12).

That last group is the boundary made operational: the one datum the system cannot generate for
itself is a person's statement that they checked something, and the architecture is arranged so it
cannot be forged, overwritten, or silently inherited.

| Guard | Fails when |
| --- | --- |
| `optimise.test.ts` | The optimiser improves a score by deleting equipment |
| `verification.test.ts`, `corpusLedger.test.ts` | A batch result is recorded as a human confirmation |

---

## Where these are enforced

Every decision D1–D16 maps to a source location, a test, and a statement of what a failure means, in
[`release/REGRESSION_PROTECTION_MAP.md`](release/REGRESSION_PROTECTION_MAP.md). The decisions
themselves, with the measurement that forced each, are in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md)
§D.

Guards are verified by **mutation** — break the guard, confirm the suite goes red — because this
repository has shipped guards that could not fail, and a green suite cannot tell the difference.
Guards that currently cannot fail are listed rather than quietly counted.
