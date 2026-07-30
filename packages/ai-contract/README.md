# @mfd/ai-contract

The vocabulary in which an AI request and an AI proposal are expressed.

**There is no AI in this package.** That is the point of the name: it holds requests, responses, the
scoring model, the installation plan, the schemas and the validator, and it would be equally valid if
the other side of the interface were a person rather than a program (AD-11). No model name, no
prompt, no token count, no HTTP client — and the linter enforces that rather than trusting it.

Sprint 6, step 1. Design: [AI_SERVICE_API.md](../../docs/architecture/AI_SERVICE_API.md).

---

## What is here

| File | |
| --- | --- |
| `src/client.ts` | `AiClient` — one interface, three implementations — and the capability list |
| `src/context.ts` | What every request carries, and the *summaries* it carries instead of documents |
| `src/scoring.ts` | The weighted scoring model, its normalisation, and why two things are outside it |
| `src/requests.ts` | Every request type |
| `src/responses.ts` | Every response type |
| `src/rationale.ts` | `AR-` codes: why a proposal is what it is, bilingual, closed set |
| `src/schema.ts` | Zod schemas, including the invariants a type cannot state |
| `src/validate.ts` | The four checks that keep an unsourced claim off the screen |
| `scoring/index.ts` | The shipped model from `standards/scoring/`, validated at module load |

Search this package for a weight and you will not find one. The seven the owner approved are data in
[`standards/scoring/dialysis.json`](../../standards/scoring/dialysis.json); what is here is the shape
they load into, and the rules about what a valid model may say.

---

## The three things worth knowing before reading the code

### 1. A request never carries the document

`GroundingBundle` is assembled per call site, so exposure is decided by code a reviewer can read
rather than by a connection being open. `planImage?: never` uses the type system as documentation:
the field cannot be set, and a reviewer sees *why* rather than noticing something missing.

### 2. Retrieval precedes reasoning, structurally

Every language response carries the passages it was built from, and `retrieved` is `.min(1)` in the
schema. A well-formed, bilingual, perfectly cited answer with no passages behind it is **rejected**:
it is an answer from memory, and AD-16 says there is no such response.

The validator distinguishes that failure from any other, because the two need different words on
screen. "Not in the indexed corpus" is an honest statement about coverage; "the assistant could not
answer" is a fault.

### 3. Two things are kept out of the weighted sum, for one reason

**Anything inside a weighted sum can be outvoted by the rest of it.**

| | How it is kept out |
| --- | --- |
| Hard compliance | A filter applied before scoring. Only *margin* is weighted, so no weighting can purchase a violation (AD-17). |
| Station count | A **constraint** on the candidate set, not a criterion. |

The owner's B-5a wording is *"Rule Compliance always has the highest priority and may never be
outweighed by optimization metrics"*, and its 40 % weight does not deliver that — 40 % is a minority
of the model. The filter does.

Station count is the same mechanism one level down, and the reason is arithmetic rather than
preference: **every other criterion improves as machines are removed.** One machine in a large room
has the most clearance margin, the best access, the shortest pipe run and the most expansion room, so
a station-count criterion at weight 0 does not sit the ranking out — it wins it, and "maximise total
engineering score" empties the room.

```
1 station    1.00
12 stations  0.65
```

So the engineer states a target, the solver satisfies it, and the weights rank what meets it.
`optimise_layout` may never emit `placement.delete`.

---

## Tests, and the ones verified by making them fail

66 unit tests. Green tests prove nothing until they have been seen to fail, so each of these was
broken and the failure observed:

| Guard | Broken by | Result |
| --- | --- | --- |
| A language response with no retrieval is rejected | Removing `.min(1)` from `retrieved` | 2 tests fail |
| A total must equal the sum of its contributions | Weakening the refinement to `sum >= 0` | 1 test fails |
| A bare total is forbidden (B-5a) | Making the refinement `() => true` | 1 test fails |
| A measured-only criterion contributes 0 | Making the refinement `() => true` | 1 test fails |
| A plan prints in an executable order | Making the refinement `() => true` | 2 tests fail |
| `station_count` cannot be a criterion | Widening the criteria key to `z.string()` | 1 test fails |
| A criterion cannot be missing | Widening the criteria key to `z.string()` | 1 test fails |
| AD-11: no AI client under `packages/` | Adding `import OpenAI from 'openai'` | eslint errors |

**Two refinements were deleted during this exercise**, and that is worth recording rather than
tidying away. The schema originally carried explicit checks for "no `station_count` in `criteria`"
and "every criterion present". Breaking each left every test green — because `z.record` with an
**enum** key is exhaustive and already rejects both. They were not a second layer; they were comments
shaped like code, and a guard that cannot fail is worse than none because it invites the next person
to trust it. The reasoning now lives on the line that actually holds.

The exercise also found the reverse case: `PASSAGE_LABEL` exists in the validator because the first
version of the uncited-number check counted the digit in `[P1]`, which would have rejected every
correctly cited response.
