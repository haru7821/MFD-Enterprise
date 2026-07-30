# AI Workflow

> **For review. Not implemented.**
> What an engineer actually does, feature by feature, and what happens underneath.
> Companion to [AI_SYSTEM_ARCHITECTURE.md](AI_SYSTEM_ARCHITECTURE.md) and
> [AI_SERVICE_API.md](AI_SERVICE_API.md).

---

## A. The shape every AI workflow has

```
engineer asks ──► request assembled from named facts ──► proposal or answer
                                                              │
                              ┌───────────────────────────────┴─────────────┐
                              │                                             │
                    a PROPOSAL: commands                          an ANSWER: text
                              │                                             │
                    editor applies to a COPY                      validated: every number
                    runs evaluate()                               cited, both languages
                    shows before / after                                    │
                              │                                     rendered with sourced
                    engineer accepts or discards                     values from the engine
                              │
                    accepted → the same commands a
                    gesture produces → undoable
```

Two invariants across every workflow below:

1. **The engineer decides.** Nothing is applied without an accept.
2. **The rule engine judges.** Every proposal is shown with its rule-engine consequences, computed
   locally, before and after.

---

## B. AI-assisted equipment placement

> *"Where does the next machine go?"*

| Step | What happens | Where |
| --- | --- | --- |
| 1 | Engineer selects a room and a catalogue item, clicks **Suggest position** | `apps/web` |
| 2 | Client assembles a `ProposalRequest`: room polygon, obstructions, existing placements, objective | `apps/web` |
| 3 | Solver generates candidate positions on a grid, then refines | `ai-local` |
| 4 | **Each candidate is evaluated by `rule-engine`** — clearance, collision, boundary | `ai-local` |
| 5 | Candidates that violate a RED rule are discarded, not ranked low | `ai-local` |
| 6 | Survivors ranked by the objective; top three returned as proposals | `ai-local` |
| 7 | Editor shows three ghosted positions with their findings, before and after | `apps/web` |
| 8 | Engineer accepts one → `placement.create` command → undoable | `apps/web` |

**Step 5 is the design.** A candidate that breaks a RED rule is not a worse option, it is not an
option — offering it ranked fourth invites an engineer to take it because the interface presented
it as a choice. The proposal list is only ever positions that satisfy the rules the project is
being judged by.

**Step 4 is why this is not a language problem.** The oracle is the rule engine, which is exact,
pure and already trusted. A model asked to place a machine could not tell you whether its answer
satisfied the clearances, and a model asked to *check* would be a second opinion competing with an
authority.

### When every candidate fails

The honest outcome, and it must be a first-class one: *"no position in this room satisfies the
rules"*, with the binding constraint named — the clearance that could not be met, or the
obstruction leaving too little floor. That is a real engineering answer. Returning the least-bad
position with a warning would be the same failure as a report that says `review_required` when it
means `inconclusive`.

---

## C. Automatic room layout

> *"Fill this room with as many stations as it takes."*

Same pipeline, run over the room rather than one position:

| Step | |
| --- | --- |
| 1 | Engineer picks a room, an equipment type, and optionally a target count |
| 2 | Solver packs the room: rows against the long axis, clearance envelopes as exclusion zones |
| 3 | Every arrangement evaluated whole — a layout is not the sum of independently valid placements |
| 4 | Best arrangement plus two alternatives returned |
| 5 | Engineer previews each as ghosted geometry with its findings, accepts one |

**Step 3 is the trap.** Twelve individually legal positions can be collectively illegal: clearance
envelopes overlap, a bed route disappears, the last station blocks the door. So the evaluation is
of the finished arrangement, and the proposal carries that whole evaluation.

**Accepting a layout is one undo step**, via a command group. An engineer who accepts twelve
machines and changes their mind presses undo once. Twelve separate steps would be technically
truthful and practically unusable.

---

## D. Layout optimisation

> *"Can this room hold more, or hold the same with better access?"*

Deliberately the **most conservative** feature in the sprint:

| | |
| --- | --- |
| Never moves a machine that is already satisfying every rule, unless the engineer asks | A layout an engineer has settled is a decision, not a starting point |
| Reports the improvement as a number | "One more station" or "300 mm more front clearance at station 4", not "better" |
| Shows what it costs | Every optimisation trades something. The proposal names it. |
| Blocked while **B-5 is open** | See below |

### B-5 blocks the ranking, not the feature

[OPEN_QUESTIONS](../OPEN_QUESTIONS.md) B-5 asks what makes one satisfying layout better than
another — station count, staff walking distance, service run length, construction cost. It is
unanswered.

Sprint 6 therefore ships optimisation that maximises **station count**, and *measures and
displays* the other objectives without ranking on them. An optimiser that silently ranked on
walking distance would be imposing a preference nobody chose, in a document an engineer signs.

The moment B-5 is answered, `LayoutObjective.primary` changes and the solver's comparator follows.
No other code moves — which is the reason it is a parameter in the contract rather than a constant
in the solver.

---

## E. Rule explanation

> *"Why does the AK98 need 1,200 mm in front?"*

| Step | Source |
| --- | --- |
| 1 | Engineer clicks a finding in the validation panel | |
| 2 | The **facts** are shown first, from the engines: threshold, origin, citation, verification | `rule-engine` |
| 3 | *Then*, if the service is available, an explanation of what it means for an installation | `ai-service` |
| 4 | Every claim in the explanation is marked with what it rests on | validation |

**Order matters.** The facts are visible before the explanation arrives, and remain if it never
does. An interface where the AI's paragraph appears first teaches an engineer to read the
paragraph, and the paragraph is the only part that can be wrong.

**What the explanation may add:** why a clearance exists at all (patient transfer, service
access), what commonly goes wrong, what to check on site. **What it may not add:** the figure, the
verdict, or whether the requirement is met.

---

## F. Natural-language engineering queries

> *"Which stations are short of rear clearance?"* · *"What is outstanding on the fourth floor?"*

| Step | |
| --- | --- |
| 1 | Engineer types a question |
| 2 | The client **classifies** it: structured, explanatory, or retrieval |
| 3 | **Structured** questions are answered by querying the findings directly — no model |
| 4 | **Explanatory** questions go to the service with a `GroundingBundle` |
| 5 | **Retrieval** questions search indexed documents and return passages with citations |
| 6 | Any answer citing nothing is discarded before display |

**Step 3 is the important one.** "Which stations are short of rear clearance?" is a filter over
`EvaluationResult[]`, and answering it with a model would be slower, unreproducible, and capable
of being wrong about data the application already holds exactly. The classifier's job is to route
as much as possible away from the model.

That is a design choice with a cost: the classifier will misroute some questions, and a misrouted
structured question gets a vaguer answer than it deserved. The alternative — everything to the
model — is faster to build and produces an assistant that can be confidently wrong about the
project's own contents.

---

## G. Installation recommendation engine

> *"What should I be worried about here?"*

Ranked recommendations, from three sources, and the order is the ranking:

| Priority | Source | Example |
| --- | --- | --- |
| 1 | RED findings | Station 3 overlaps Column C4 |
| 2 | Draft field groups on equipment in use | The AK98's service clearance is not cited |
| 3 | Uncalibrated levels | 5F cannot be measured |
| 4 | Checklist categories with derived items | Electrical: three outstanding |
| 5 | Model-suggested considerations, **marked as such** | Bed route from the door to station 8 is 900 mm |

Priorities 1–4 need no model: they are the report's own contents, ranked. Priority 5 is where the
assistant adds something, and it is visually separated because it has a different epistemic
status — a considered suggestion, not a finding.

**A recommendation never says "compliant".** It says what to check. The verdict is the report's.

---

## H. Report summarisation

> *"Give me three sentences for the covering email."*

| | |
| --- | --- |
| Input | The report model, **minus every raster** |
| Output | A draft, in the assistant panel |
| Where it goes | Wherever the engineer copies it |
| Where it does **not** go | The report |

Restating from the architecture, because it is the decision most likely to be questioned:
**generated prose does not enter the signed document.** The report's own text is composed from
label keys and reason codes precisely so that every sentence in it is traceable; a paragraph a
model wrote would be the only untraceable text in the document, and it would sit under a
signature.

An engineer who wants that paragraph in an email is welcome to it. That is a different artefact
with a different standard.

---

## I. Engineering knowledge retrieval

> *"What does the manual say about drain height?"*

| Step | |
| --- | --- |
| 1 | Documents are indexed ahead of time — manuals, standards, the project's own reports |
| 2 | A question retrieves passages |
| 3 | Passages are returned **with document, revision and section** |
| 4 | The engineer reads the passage. The assistant does not paraphrase it into a figure. |

**Step 3 is the whole feature.** A retrieved passage with a citation is evidence an engineer can
act on and a report can quote. The same passage summarised into "the drain must be 40 mm" is an
uncited figure wearing the appearance of one — and this product's entire discipline is that a
figure without a document behind it is not a figure.

**Retrieval is also the path out of A-1.** If the AK98 manual is indexed, the assistant can find
the clearance table and an engineer can transcribe it into the catalogue **with its citation**.
The AI does not write the catalogue: it helps a person find what to write, and a person writes it.
That is the correct division for the data the whole product is blocked on.

---

## J. Failure, plainly

| What fails | What the engineer sees | What changes in the document |
| --- | --- | --- |
| No service configured | Language features hidden; solver features work | Nothing |
| Service unreachable | "The assistant is unavailable" | Nothing |
| Response fails validation | "The assistant could not answer that" | Nothing |
| A proposal makes findings worse | The before/after shows it; accept is still theirs | Nothing until accepted |
| Solver finds nothing legal | "No position in this room satisfies the rules", with the binding constraint | Nothing |
| Contract version mismatch | Capability reported unavailable | Nothing |

Every row's last column is the same, and that is the property to hold onto: **an AI failure is
never a document failure.**
