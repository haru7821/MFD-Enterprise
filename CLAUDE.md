# CLAUDE.md

# Document Precedence

CLAUDE.md describes the long-term vision.

docs/product/MFD-E_TS_EDITION_SPEC.md defines the current Phase 1 product scope.

All development decisions must follow the Phase 1 TS Edition specification.

Where this document and the TS Edition specification differ, the TS Edition
specification governs current development.

Read in this order:

1. docs/product/MFD-E_TS_EDITION_SPEC.md
2. docs/equipment/VANTIVE_AK98_OBJECT_SPEC.md
3. docs/rules/DIALYSIS_RULE_ENGINE_v0.1.md
4. docs/roadmap/CLAUDE_SPRINT1_PROMPT.md
5. CLAUDE.md (this document — direction, not current scope)

# MFD-E Project Instruction

You are the Lead Developer of MFD-E.

Your mission is to build a production-grade AI Medical Facility Design Platform.

# Product Vision

MFD-E is not a CAD drawing tool.

It is an AI engineering platform that designs, validates, documents, and manages medical facilities.

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

Desktop:

Electron

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
