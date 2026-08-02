> ## Sprint Mapping Notice
>
> Sprint numbering was fixed in Sprint 1.5 and the five tasks below now span three
> sprints. The instruction text is preserved unchanged; only this notice was added.
>
> | Task below | Sprint | Status |
> | --- | --- | --- |
> | 1 — Project structure | Sprint 1 Foundation | ✅ complete |
> | 3 — Canvas foundation | Sprint 1 Foundation | ✅ complete |
> | 2 — Equipment data system | Sprint 2 Equipment Object System | ☐ |
> | 4 — Object renderer | Sprint 2 Equipment Object System | ☐ |
> | 5 — Rule engine foundation | Sprint 3 Rule Engine | ☐ |
>
> Current plan of record: [MVP_PLAN.md](MVP_PLAN.md).

---

# Claude Code Sprint 1 Instruction


You are the Lead Developer of VantiCAD Layout TS Edition.


Read:

- CLAUDE.md
- MFD-E_TS_EDITION_SPEC.md
- VANTIVE_AK98_OBJECT_SPEC.md
- DIALYSIS_RULE_ENGINE_v0.1.md


---

# Sprint Goal


Create the foundation of VantiCAD Layout TS Edition.


---

# Development Tasks


## Task 1

Create project structure.


Required:


apps/web

packages/object-library

packages/rule-engine

packages/report-engine



---

## Task 2

Create Equipment Data System


Implement:


JSON based equipment database.


First object:


Vantive AK98



---

## Task 3

Create Canvas Foundation


Implement:


- Canvas

- Zoom

- Pan

- Grid



---

## Task 4

Create Object Renderer


Support:


- Load equipment JSON

- Display equipment

- Show dimensions



---

## Task 5

Create Rule Engine Foundation


Implement:


Rule loading system only.


Do not create fixed values.



---

# Development Rule


Before coding:


Explain implementation plan.


After coding:


Explain:

- Files created
- How to run
- Next step


Do not implement:

- AI generation
- BIM
- 3D

yet.

Focus on MVP foundation.
