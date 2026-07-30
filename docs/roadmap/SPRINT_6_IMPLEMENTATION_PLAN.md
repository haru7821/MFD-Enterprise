# Sprint 6 — Implementation Plan

> **Not started. Implementation waits on approval of this plan and the four architecture
> documents.**
> Sprint 6 — AI Engineering Assistant.
>
> [AI_SYSTEM_ARCHITECTURE.md](../architecture/AI_SYSTEM_ARCHITECTURE.md) ·
> [AI_SERVICE_API.md](../architecture/AI_SERVICE_API.md) ·
> [AI_WORKFLOW.md](../architecture/AI_WORKFLOW.md) ·
> [AI_PROMPT_GUIDELINES.md](../architecture/AI_PROMPT_GUIDELINES.md)

---

## A. The plan in one paragraph

Five of the owner's eight features need no language model. Build those first, deterministically, in
TypeScript, with the rule engine as the oracle — they ship whatever the answer to data residency
turns out to be. Then add the language half behind the same interface, so the application works
without it. The report engine gains no parameter and `packages/` gains no AI dependency; if either
happens, the boundary leaked and the sprint is wrong.

---

## B. What is settled, and what blocks what

| | |
| --- | --- |
| **Settled** | The mission is engineering decision support. No LLM in business logic. An AI service layer behind stable interfaces. Sprint 6 scope is the owner's eight features. |
| **Awaiting review** | These five documents. |
| **Blocks the language half** | **B-4** — may project data leave the hospital network? |
| **Blocks the optimiser's ranking, not the optimiser** | **B-5** — what makes one satisfying layout better than another? |
| **Blocks nothing here, still blocks the product** | **A-1** — the AK98 manual. |

### B-4 is the only real gate, and it gates half a sprint

| If | Then |
| --- | --- |
| Data may not leave the network | Steps 1–4 ship. Five features work. Steps 5–7 wait for an on-premises deployment decision. |
| Data may leave | All seven steps ship. |
| Self-hosted model | All seven steps ship; only `apps/ai-service` configuration differs. |

The architecture is arranged this way on purpose. **I would rather start on the answerable half than
wait**, and I would like the plan approved on that basis: steps 1–4 are useful, shippable, and
unaffected by B-4.

### B-5: what I will do while it is open

Optimise **station count**, measure the other objectives, rank on none of them. An optimiser that
silently ranked on walking distance would impose a preference nobody chose, inside a document an
engineer signs. When B-5 is answered it is one comparator and one contract field.

---

## C. Order of work

Seven steps. Each ends green, and each is useful on its own.

### Step 1 — `packages/ai-contract` (≈2 days)

| Files | |
| --- | --- |
| `src/client.ts` | `AiClient`, `AiCapability` |
| `src/requests.ts` | Every request type, with `GroundingBundle` and `planImage?: never` |
| `src/responses.ts` | `AiProposal`, `AiExplanation`, `AiAnswer`, `Citation` |
| `src/schema.ts` | Zod schemas, including the citation and bilingual checks |
| `src/rationale.ts` | `AR-` codes, bilingual, exactly like the rule engine's reason codes |
| `src/validate.ts` | `validateResponse` — the uncited-number check |
| Tests | Shape locks, citation validation, refusal handling |

**Why first, and why it contains no AI.** It is the vocabulary both halves speak, and the validator
is what makes the language half safe. Writing it before either implementation means neither can
quietly widen it.

**Done when** a hand-written response with an uncited number is rejected, a response missing Korean
is rejected, and a citation naming an absent rule is rejected — each **verified by making the check
fail**.

### Step 2 — the solver's geometry and candidates (≈3 days)

| Files | |
| --- | --- |
| `packages/ai-local/src/candidates.ts` | Position generation: grid, wall-aligned, row-packed |
| `src/constraints.ts` | Rule-engine evaluation per candidate |
| `src/rank.ts` | Objective comparators; station count implemented, others measured |
| `src/place.ts` | `proposePlacement` — one machine |
| Tests | Determinism, RED-rejection, the no-legal-position case |

**Done when** the same room produces the same three proposals twice, a candidate breaking a RED rule
is *absent* rather than ranked low, and a room too small produces "no position satisfies the rules"
naming the binding constraint.

### Step 3 — room layout and optimisation (≈3 days)

| Files | |
| --- | --- |
| `src/layout.ts` | `proposeLayout` — pack a room |
| `src/optimise.ts` | `optimiseLayout` — improve an existing arrangement |
| Tests | Whole-arrangement evaluation, the improvement is a stated number, nothing settled moves unasked |

**The trap this step exists to avoid:** twelve individually legal positions can be collectively
illegal — clearance envelopes overlap, a bed route disappears, the last station blocks the door. The
evaluation is of the finished arrangement.

### Step 4 — the assistant panel and proposal review (≈3 days)

| Files | |
| --- | --- |
| `apps/web/src/features/assistant/AssistantPanel.tsx` | The panel |
| `.../ProposalReview.tsx` | Ghosted geometry, before/after findings, accept or discard |
| `.../useProposals.ts` | Client wiring, capability gating |
| `.../compositeClient.ts` | Routes per capability across the two implementations |
| `tests/e2e/assistant.spec.ts` | A1–A6 |

**Done when** an engineer can ask for a position, see three proposals with their rule-engine
consequences, accept one, and undo it in a single step — with no AI service configured at all.

**That last clause is the acceptance criterion for the whole architecture.** If step 4 needs a
service, the boundary leaked.

### Step 5 — `apps/ai-service` skeleton (≈2 days)

| | |
| --- | --- |
| FastAPI, `/v1/{explain,ask,retrieve,summarise}` | |
| Request/response models mirroring `ai-contract`, with a contract-version check | |
| `prompts/` with the AUTHORITY block and the refusal format | |
| No model call yet — a fixed, valid, correctly cited response | |

**A stub that returns a valid response is the point.** It exercises the transport, the validator and
the panel before a model is involved, so the first real model call is debugging one thing.

### Step 6 — explanation and query (≈3 days)

| | |
| --- | --- |
| Prompt files per capability, versioned | |
| The **classifier**: structured questions answered from findings, never sent to a model | |
| Golden, refusal, injection and bilingual evaluation sets | |
| Retrieval over indexed documents, citations required | |

**Done when** the golden set's citation sets are stable across runs, the refusal set returns
`insufficientGrounding` with no invented figures, and the injection set does not follow an
instruction typed into a room name.

### Step 7 — recommendations and summarisation (≈2 days)

| | |
| --- | --- |
| Ranked recommendations: RED, uncited groups, uncalibrated levels, checklist items, then model suggestions marked as such | |
| Report summarisation **into the panel** — never into the report | |
| Documentation, CI, the Sprint 6 review | |

---

## D. Estimate

| Step | Days | Needs B-4 |
| --- | --- | --- |
| 1 · `ai-contract` | 2 | No |
| 2 · Solver candidates | 3 | No |
| 3 · Layout and optimisation | 3 | No |
| 4 · Panel and proposal review | 3 | No |
| 5 · Service skeleton | 2 | Yes |
| 6 · Explanation, query, retrieval | 3 | Yes |
| 7 · Recommendations, summarisation | 2 | Partly |
| **Total** | **18 working days** ≈ 3.5 weeks | |

**Steps 1–4 are 11 days and deliver five of the eight features.** If B-4 comes back "data may not
leave", that is the sprint, and it is a good one.

Step 6 is the one I expect to slip, and for a reason worth stating: prompt evaluation is not
finished when it works once. The citation-stability test is what will take the time, and it is the
test that decides whether the feature can be trusted.

---

## E. Test budget

| | Added |
| --- | --- |
| Unit suites | ~10 (`contract.shape`, `validate`, `rationale`, `candidates`, `constraints`, `rank`, `layout`, `optimise`, `classifier`, `recommend`) |
| Unit tests | ~85 |
| Browser specs | 6 (A1–A6) |
| Prompt evaluation sets | 4 (golden, refusal, injection, bilingual) |

Four checks to be **verified by making them fail**, chosen because each guards a claim rather than a
mechanism:

| Check | How it will be broken |
| --- | --- |
| A proposal breaking a RED rule is never offered | Remove the rejection and confirm a red candidate appears |
| An uncited number is rejected | Hand-write a response with a bare figure |
| The application works with no AI service | Configure none and run the whole browser suite |
| A prompt-injected instruction is not followed | Name a room with an instruction and assert the figure is absent |

The third is the architecture's own test, and it belongs in CI: **`pnpm test:e2e` with no AI service
configured must pass in full.** Not as a special case — as the default.

---

## F. Risks

| Risk | Handling |
| --- | --- |
| **The model becomes an authority by accident** | Structural, not procedural: uncited numbers rejected by the validator, sourced values rendered from the source, `packages/` unable to import an AI client. Three layers, because a prompt instruction is a request and not a constraint. |
| **B-4 is answered "no"** | Steps 1–4 ship regardless. Five features, no service. |
| **B-5 stays open** | Station count only; other objectives measured, not ranked. |
| **The solver is too slow to feel interactive** | Candidate generation is bounded and the rule engine is ~6 ms per level at fifty machines. If it is slow, it is the candidate count, which is a parameter. Measured before the panel is built, not after. |
| **Prompt drift** | Versioned prompt files, citation-stability tests, and a review checklist with objective questions. |
| **Scope creep into agentic editing** | Explicitly out. One reviewable proposal at a time; a sequence of self-directed edits is not auditable. |
| **An engineer starts trusting the assistant's prose over the findings** | The facts render first and stay if the explanation never arrives. Model suggestions are visually separated from findings. |

---

## G. Not in Sprint 6

Auto-applied changes · generated prose in the signed report · fine-tuning on customer projects ·
agentic multi-step editing · voice or image input · a second language beyond Korean and English ·
routing and automatic layout as *unsupervised* features (the proposals are supervised by
construction).

---

## H. Definition of done

1. An engineer can ask for a position, a room layout, or an optimisation, see proposals with their
   rule-engine consequences before and after, accept one, and undo it in one step.
2. **All of that works with no AI service configured.**
3. Every AI-originated numeric claim carries the id of the engine output it came from, and an
   unsourced one cannot reach the screen.
4. Language features are bilingual, and a response missing either language is rejected.
5. `buildReport` has gained no parameter, and no package under `packages/` imports an AI client.
6. Typecheck, lint, unit tests and both CI workflows green, with the browser suite passing with no
   service configured.

**Point 5 is the one that says whether the architecture held.** Points 2 and 3 are the ones that say
whether the feature can be trusted.
