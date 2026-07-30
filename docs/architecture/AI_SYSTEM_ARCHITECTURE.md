# AI System Architecture

> **For review. Not implemented.**
> Sprint 6 — AI Engineering Assistant.
> Product mission, owner decision: *"AI-assisted Dialysis Facility Engineering Platform."*
>
> Related: [AI_SERVICE_API.md](AI_SERVICE_API.md) · [AI_WORKFLOW.md](AI_WORKFLOW.md) ·
> [AI_PROMPT_GUIDELINES.md](AI_PROMPT_GUIDELINES.md) ·
> [../roadmap/SPRINT_6_IMPLEMENTATION_PLAN.md](../roadmap/SPRINT_6_IMPLEMENTATION_PLAN.md)

---

## A. The constraint that shapes everything

> Owner decision: *"Do NOT implement LLM-specific code inside business logic. Introduce an AI
> Service layer that communicates only through stable interfaces."*

Taken literally and made structural, that is one rule:

**No package under `packages/` may import an AI client, a model name, a prompt, or a token
count.** The linter already forbids React, Konva, NestJS and Node built-ins there; the AI client
joins that list, so the boundary is enforced at build time rather than by memory.

Everything below follows from it.

### Why the constraint is right, not merely instructed

A dialysis installation review is a document somebody signs. Three consequences:

1. **A model cannot be an authority.** If an LLM decides whether 1,200 mm of clearance is
   satisfied, the answer is unreproducible and uncitable, and the rule engine's whole design —
   every threshold from a file, every finding naming its source — is bypassed by the newest
   component.
2. **A model cannot be a dependency of correctness.** `evaluate()` is pure and produces
   identical bytes twice. That property is what lets a server's verdict be compared against the
   browser's. An AI call inside it destroys the property permanently.
3. **A model must not be able to write to the document silently.** Any AI change to a layout has
   to arrive as a **proposal** an engineer accepts, expressed in the same commands a hand
   gesture produces — so it is undoable, reviewable and visible in the history.

So the AI's job is **decision support**, not decision making. It proposes, explains, retrieves
and summarises. The rule engine judges.

---

## B. Where the AI sits

```
┌──────────────────────────────────────────────────────────────────────┐
│ apps/web                                                             │
│  ┌──────────────┐   ┌──────────────────┐   ┌───────────────────────┐ │
│  │ Canvas       │   │ Assistant panel  │   │ Proposal review UI    │ │
│  └──────────────┘   └────────┬─────────┘   └───────────┬───────────┘ │
│                              │ AiClient (interface)    │             │
└──────────────────────────────┼─────────────────────────┼─────────────┘
                               │                         │
                    ┌──────────▼─────────────────────────▼──────────┐
                    │ packages/ai-contract   (pure TypeScript)      │
                    │  request + response types, Zod schemas,       │
                    │  the AiClient interface. NO model, NO prompt. │
                    └──────────┬────────────────────────┬───────────┘
                               │                        │
              ┌────────────────▼───────────┐   ┌────────▼─────────────────────┐
              │ packages/ai-local          │   │ apps/ai-service (Python)     │
              │ deterministic solver:      │   │ FastAPI + LLM                │
              │ layout, spacing, ranking.  │   │ language, explanation,        │
              │ NO LLM.                    │   │ retrieval, summarisation.     │
              └────────────┬───────────────┘   └────────┬─────────────────────┘
                           │                            │
              ┌────────────▼────────────────────────────▼───────────┐
              │ packages/rule-engine · object-library · document-   │
              │ model · report-engine — unchanged, and unaware      │
              │ that an AI exists                                  │
              └────────────────────────────────────────────────────┘
```

### The two implementations behind one interface

This is the load-bearing decision of the sprint, and it is not the obvious one.

| | `ai-local` | `ai-service` |
| --- | --- | --- |
| What it is | A deterministic solver in TypeScript | FastAPI + an LLM |
| Runs | In the browser, offline | Over HTTP |
| Handles | Layout generation, spacing, packing, ranking | Natural language, explanation, retrieval, summarisation |
| Reproducible | **Yes** — same input, same output | No |
| Needed for a signed report | Yes | No |

**Layout optimisation is not a language problem.** Placing twelve stations in a room subject to
clearance and access constraints is a packing problem with a rule engine as its oracle. A solver
does it reproducibly, offline, in milliseconds, and an engineer can be told exactly why it chose
what it chose. An LLM doing the same work would produce a different layout each run, unable to
guarantee the constraints it was given, and the audit trail would be a transcript.

So the sprint's *first* deliverable is the solver, and the LLM is the part that talks about it.
Both sit behind `AiClient`, so the interface is what the editor knows and either half can be
absent:

| Feature | Needs the LLM? |
| --- | --- |
| AI-assisted equipment placement | No — solver |
| Layout optimisation | No — solver |
| Automatic room layout proposals | No — solver |
| Installation recommendation engine | No — rules + solver, ranked |
| Rule explanation engine | **Partly** — the facts come from the rule set; the prose is the LLM's |
| Natural-language engineering queries | Yes |
| Report summarisation | Yes |
| Engineering knowledge retrieval | Yes |

Five of eight features in the owner's scope work with no model at all. That is worth stating
plainly, because it means the sprint's value does not depend on B-4 (data residency) being
answered — the solver ships either way.

---

## C. New packages and applications

| Where | What | Depends on |
| --- | --- | --- |
| `packages/ai-contract` | Request/response types, Zod schemas, `AiClient`, `AiProposal`. Pure. | `document-model`, `rule-engine`, `object-library` |
| `packages/ai-local` | The deterministic solver: candidate generation, constraint evaluation via `rule-engine`, ranking. Pure. | `ai-contract`, `cad-engine`, `rule-engine` |
| `apps/ai-service` | Python FastAPI. Prompt assembly, model calls, retrieval. | HTTP only |
| `apps/web/src/features/assistant` | The panel, the proposal review UI, the client wiring | `ai-contract`, `ai-local` |

**`ai-contract` has no AI in it.** That is the point of the name: it is the vocabulary in which
a request and a proposal are expressed, and it would be equally valid if the other side were a
person. Both implementations, the editor, and any future server read it.

**Nothing in `packages/` gains a dependency on `apps/ai-service`.** The HTTP client lives in
`apps/web`, because a network call is a host concern — the same rule that keeps `fetch` out of
the report engine and font bytes an argument.

---

## D. The proposal, and why the AI cannot write to the document

Every AI change to a layout is an `AiProposal`: a list of **commands** plus the evaluation of
what the document would look like if they were applied.

```ts
interface AiProposal {
  readonly id: string;
  readonly kind: 'placement' | 'layout' | 'adjustment';
  readonly rationale: readonly RationaleItem[];   // codes, not prose — see below
  readonly commands: readonly ProposedCommand[];  // the same commands a gesture produces
  readonly evaluation: ProposalEvaluation;        // rule-engine output, before and after
  readonly confidence: 'deterministic' | 'heuristic' | 'suggestion';
}
```

Four properties follow, and each of them is a defect avoided:

| Property | The defect it prevents |
| --- | --- |
| Commands, not a mutated document | An AI change that undo cannot reverse, and that the history does not show |
| Evaluation before **and** after | A proposal that improves one clearance and breaks two, presented as an improvement |
| `confidence` names the source | A heuristic guess reading exactly like a solver result |
| `rationale` is codes | Prose that says a rule was satisfied when the rule engine says otherwise |

**A proposal is never auto-applied.** The engineer reviews the before/after findings and accepts
or discards. The reason is not caution about AI in general: it is that accepting a layout is an
engineering decision with a signature attached to it, and the person signing has to have seen
it.

### Rationale is codes, like findings

The rule engine's reason codes exist because a finding must mean the same thing in Korean, in
English, and in a support conversation six months later. A rationale has the same requirement,
so it uses the same mechanism — extended with `AR-` codes for proposal reasoning:

```
AR-201
전면 정비 공간 확보를 위해 300 mm 이동
Moved 300 mm to satisfy front service clearance
```

An LLM may **not** invent a rationale code. It may render one into fluent prose when asked, and
that is a different operation with a different failure mode: bad prose is embarrassing, an
invented justification is a document that lies about why a machine is where it is.

---

## E. What the AI is allowed to assert, and what it is not

The single most important table in this document.

| Question | Answered by | May the LLM answer it? |
| --- | --- | --- |
| Does this layout satisfy the clearance rules? | `rule-engine` | **No** |
| What is the AK98's front clearance? | The catalogue, with its citation | **No** |
| Is this figure verified? | `fieldVerification` | **No** |
| What is the verdict? | `report-engine` | **No** |
| Where should this machine go? | `ai-local` solver, checked by `rule-engine` | **No** |
| *Why* does this rule exist? | The rule's own description, plus retrieval | Yes, with sources |
| What does this finding mean in practice? | Explanation over `rule-engine` output | Yes |
| Summarise these forty findings | Summarisation over the report model | Yes |
| Which manual section covers drain sizing? | Retrieval over indexed documents | Yes, **with the citation** |

The pattern: the LLM may **explain, rephrase, retrieve and summarise facts the engines
produced**. It may not produce a fact.

Enforcement is not a prompt instruction — a prompt is a request, not a constraint. It is
structural:

1. **Every numeric claim in an AI response must carry the id of the finding, rule or catalogue
   field it came from.** A response with an unsourced number fails schema validation and is
   discarded before the engineer sees it.
2. **The assistant panel renders sourced values from the source**, not from the model's text: the
   model produces a template with slots, and the client fills them from the engine output. A
   model that hallucinates "1,400 mm" cannot get that number onto the screen, because the number
   is not taken from its reply.
3. **Nothing the LLM returns reaches the report.** Report summarisation writes into the assistant
   panel, and an engineer copies what they choose into a field they own. The signed document
   does not contain unattributed generated prose.

Point 3 is the one to argue about, and I want it on the record before code exists: the owner's
scope lists "report summarisation", and the safe version of it is a summary an engineer reads and
edits, not a paragraph that appears in a PDF a hospital receives.

---

## F. Determinism, and what happens when the service is absent

| State | The application |
| --- | --- |
| No AI service configured | Works entirely. The solver runs locally; language features are hidden, not broken. |
| Service unreachable | Language features report unavailable. Nothing about the layout, the findings or the report changes. |
| Service returns nonsense | Schema validation rejects it. The panel says the assistant could not answer. |

**The report never depends on the AI.** `buildReport` gains no parameter in Sprint 6. That is the
test of whether this architecture held: if the report engine has to change to accommodate the
assistant, the boundary leaked.

---

## G. Data residency — B-4, and why the split answers it early

[OPEN_QUESTIONS](../OPEN_QUESTIONS.md) B-4 asks whether project data may leave the hospital
network. It is still open, and the architecture above is deliberately arranged so that Sprint 6
does not wait for it:

| If the answer is | Then |
| --- | --- |
| Data may not leave | Ship `ai-local` only. Five of eight features work. `apps/ai-service` is deployed on-premises later, or not at all. |
| Data may leave | Both halves ship. Requests carry the minimum: see [AI_SERVICE_API.md](AI_SERVICE_API.md) § D. |
| Self-hosted model | `apps/ai-service` is unchanged; only its model configuration differs. |

**No request ever carries the plan image.** A floor plan is the most identifying artefact in the
document, it is megabytes, and no language feature needs it. That is a constraint in the contract
rather than a habit — see AI_SERVICE_API.md § D.

---

## H. What this architecture deliberately does not do

| | Why |
| --- | --- |
| An LLM inside the rule engine or the report engine | Owner decision, and the reasons in § A |
| Auto-applied layout changes | An engineering decision needs a person |
| Generated prose in the signed report | § E point 3 |
| Fine-tuning on customer projects | Wants a data agreement nobody has asked for |
| Agentic multi-step tool use over the document | A single proposal an engineer reviews is auditable; a sequence of self-directed edits is not. Revisit when the review UI has earned trust. |
| Voice or image input | Not in the owner's scope |

---

## I. Architecture decisions this adds

| # | Decision |
| --- | --- |
| AD-11 | **No package under `packages/` may import an AI client, a model name or a prompt.** Enforced by the linter, like every other boundary. |
| AD-12 | **The AI proposes; the engines decide.** Every AI-originated change is a command list plus a rule-engine evaluation, accepted by a person. |
| AD-13 | **Every AI numeric claim carries the id of the engine output it came from.** Unsourced numbers fail validation and never render. |
| AD-14 | **Layout optimisation is deterministic.** A solver with the rule engine as its oracle, not a language model. |
| AD-15 | **The application works with no AI service.** Absence hides features; it never breaks the review or the report. |
