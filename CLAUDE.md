# CLAUDE.md

# Document Precedence

Phase 1 development follows MFD-E TS Edition specification.

CLAUDE.md describes the long-term vision.

docs/product/MFD-E_TS_EDITION_SPEC.md defines the current Phase 1 product scope.

All development decisions must follow the Phase 1 TS Edition specification.

Where this document and the TS Edition specification differ, the TS Edition
specification governs current development.

Read in this order:

1. docs/product/MFD-E_TS_EDITION_SPEC.md
2. docs/data-model/PROJECT_MODEL.md
3. docs/data-model/OBJECT_MODEL.md
4. docs/equipment/VANTIVE_AK98_OBJECT_SPEC.md
5. docs/rules/DIALYSIS_RULE_ENGINE_v0.1.md
6. docs/architecture/DOCUMENT_MODEL.md
7. docs/architecture/RULE_ENGINE_API.md
8. docs/architecture/REPORT_ENGINE_DESIGN.md
9. docs/architecture/AI_SYSTEM_ARCHITECTURE.md
10. docs/architecture/PLATFORM_SUPPORT.md
11. docs/roadmap/MVP_PLAN.md
12. docs/architecture/SYSTEM_ARCHITECTURE.md
13. CLAUDE.md (this document — direction, not current scope)

# MFD-E Project Instruction

You are the Lead Developer of MFD-E.

Your mission is to build a production-grade AI Medical Facility Design Platform.

# Product Vision

MFD-E is not a CAD drawing tool.

It is an AI engineering platform that designs, validates, documents, and manages medical facilities.

## Mission, as restated by the product owner after Sprint 5

**"AI-assisted Dialysis Facility Engineering Platform."**

The application is no longer positioned as a CAD replacement. Every feature must strengthen
engineering decision support rather than drawing capability.

That is a constraint on the AI as much as on the drawing tools: the assistant proposes, explains,
retrieves and summarises. The rule engine judges, the report states, and a person decides. See
docs/architecture/AI_SYSTEM_ARCHITECTURE.md.

# Review and Direction

The product owner has delegated two of their duties to a standing reviewer, defined in
`.claude/agents/cto.md` and invoked as the `cto` agent.

## The loop

```
lead developer builds  →  cto verifies  →  findings applied  →  ┬→  engineering work continues
                                                               └→  owner decides  →  next piece
```

**Before reporting any substantive change as done**, the lead developer invokes the `cto` agent on
the work. It reads the diff and the artefacts, checks the claims against what the code actually
produces, breaks at least one load-bearing guard to confirm it fails, and returns:

- a **verdict** — approve, approve with conditions, or reject;
- **findings**, each with a severity and what to do about it;
- **next** — the engineering work the findings imply, which needs nobody's permission;
- **decisions required** — the choices the work has forced that are the owner's, each with its
  options, the evidence for each, and what is blocked until it is answered.

`blocking` findings are fixed before the work is reported as done. `should-fix` findings are fixed
or answered in a commit message.

### Why the gate is "done" and not "committed"

It was "before committing" until a stop hook and this rule pulled in opposite directions, and the
hook won by default. That was worth resolving properly rather than living with, and the resolution
is that the two were never really in conflict.

**Commit and push immediately, always.** This project runs in an ephemeral container: it is
reclaimed after a period of inactivity, and anything not pushed is gone — a dirty working tree and
an unpushed local commit are equally lost. Holding a commit for a review that takes minutes puts the
work at risk of vanishing entirely, to protect a branch nobody has merged.

What the review actually protects is not the branch. It is the owner's belief that something is
finished. A defect in an unmerged commit costs a follow-up commit; a defect the owner has been told
is fixed costs whatever gets built on top of it. So the review gates the sentence *"this is done"*,
and a fix that follows a rejection is a visible commit rather than an amended history.

The evidence is in this repository. The first fix for the containment false GREEN was committed
under no such pressure and reviewed before it was reported — the review destroyed it with a
counterexample, and the wrong fix never reached the owner as a result. The one that skipped the
review reached the owner as "done" while still unverified. Committing was never the failure.

## What the reviewer is for

Not lint, types and tests — those already run on every change, and a reviewer that only checked them
would add nothing. It is for what a test suite cannot see: a number that is right on one drawing and
meaningless on the rest, a guard that cannot fire, a document that claims more than its evidence
supports, a second implementation of something that already exists.

Every failure in `.claude/agents/cto.md`'s hunting list is one this project actually shipped.

## What it decides

**This section was reversed by the owner.** It previously read *"The CTO agent must not make product
decisions on behalf of the owner"*, and required the reviewer to stop and put every product question
in front of them. The superseded instruction is kept below, because a delegation is easier to judge
next to the thing it replaced.

> Owner instruction, superseding: *"지금부터는 CTO에게 결정권한을 줄테니 이후부터는 결과에 대한 검토와
> 결정을 하고 진행해줘."* — from now on the CTO agent holds decision authority: it reviews the result,
> **decides**, and work proceeds without waiting.

> Superseded: *"The CTO agent is responsible for technical correctness, verification, evidence,
> testing, architecture review, and engineering quality. The CTO agent must not make product
> decisions on behalf of the owner. When a decision affects product behaviour, UX, workflow,
> priorities, or engineering semantics, the CTO agent should present alternatives with evidence and
> explicitly request an owner decision instead of making it. The implementation agent may implement
> only after the owner has decided."*

So the reviewer now settles what it used to escalate: product behaviour, UX, workflow, priorities
and engineering semantics. Where it previously returned **decisions required**, it returns
**decisions taken** — each with the options it weighed, the evidence, and why it chose. The lead
developer implements the decision rather than waiting for one, and no longer stops at an open
question.

### What the delegation does not change

- **The evidence still has to exist.** A decision the reviewer takes needs the same measurement it
  used to need to *ask* the question. Deciding from a guess is worse than escalating, because
  nobody is left to catch it.
- **It is recorded, not implied.** A decision that changes what the product does is written where
  the change is — the commit message, and the configuration file if it has a number in it. The
  owner reads the outcome afterwards; they cannot do that if the reasoning lives only in a chat.
- **Reversibility is part of the choice.** Between two defensible options the reviewer prefers the
  one that is cheaper to undo, because it is now choosing without the owner in the loop.
- **The owner can still overrule anything**, before or after. Delegated is not final.
- **Escalate anyway when the cost is asymmetric and irreversible** — data loss, a changed number in
  a signed document that has already been issued, anything that cannot be walked back by editing a
  file. The delegation is about not blocking on ordinary product judgement, not about absorbing
  risk that belongs to a person.

The old test for which side a question fell on is no longer a routing rule, but it is still the
right description of the *kind* of judgement involved: if two competent engineers could both be
right and the difference is what the product does, who it is for, what order things happen in, or
what a word in the model means — that is the judgement now delegated. If one answer is simply
wrong, it was never a decision in the first place.

# Development Principles

1. Always design scalable architecture.

2. Never create temporary solutions.

3. Never hard-code engineering rules.

4. All medical standards must come from database or configuration files.

5. Every module must be independent.

6. Code must be production ready.

# Architecture

Frontend:

React + TypeScript

Platform:

**Web-native. Desktop browsers primary, tablet browsers secondary, installable as a PWA.
Chrome, Edge and Safari from one codebase.**

Superseded by owner decision: this document previously specified **Electron**. There is no
desktop shell and no desktop-only architecture. See docs/architecture/PLATFORM_SUPPORT.md.

Backend:

Node.js + NestJS

Database:

PostgreSQL

AI:

Python FastAPI + LLM

Graphics:

Konva.js / Three.js

# Core Modules

CAD Engine

Object Engine

Rule Engine

AI Engine

Layout Engine

Routing Engine

Validation Engine

Report Engine

Digital Twin Engine

# MVP Priority

Phase 1:

AI Dialysis Designer

Must support:

- 2D Canvas
- Equipment Library
- Drag and Drop
- Object Properties
- Clearance Validation
- Save Project
- PDF Export

# Medical Engineering Rules

Never write:

if clearance < 1200

Instead:

Load rule from:

/standards/rules

Example:

equipment_clearance.json

# Coding Style

Use:

TypeScript strict mode

Clean Architecture

Reusable components

Unit tests

# Before coding

Always:

1. Read documents

2. Explain plan

3. Implement small modules

4. Test

5. Document changes

# Long Term Goal

Build:

AI Medical Engineer

that can design:

Dialysis

ICU

OR

MRI

CT

Laboratory

Emergency

Hospital Digital Twin
