# CLAUDE.md

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
