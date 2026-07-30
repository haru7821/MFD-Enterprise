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
