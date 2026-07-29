# MFD-E TS Edition Specification

Version:
0.1 Alpha

Product:
Medical Facility Designer Enterprise - TS Edition


# 1. Product Definition

MFD-E TS Edition is an AI-assisted dialysis facility design application for Vantive Technical Service Engineers.

The purpose is not to replace general CAD software.

The purpose is:

"Help TS engineers evaluate dialysis installation feasibility quickly and accurately."


---

# 2. Target User

Primary:

Vantive TS Engineer


Secondary:

- Project Engineer
- Clinical Engineer
- Hospital Facility Team
- Installation Partner


---

# 3. Main Problem

Current workflow:

Hospital provides drawing.

Engineer manually checks:

- Machine location
- Power
- RO
- Drain
- Service space
- Maintenance access


Problems:

- Time consuming
- Depends on engineer experience
- Missing requirements
- Difficult documentation


---

# 4. MFD-E Solution


Input:

PDF Floor Plan


Process:

1. Import drawing
2. Define dialysis room
3. Place equipment
4. Validate installation requirements
5. Generate report


Output:

Installation feasibility report


---

# 5. MVP Features


## 5.1 Floor Plan Import

Supported:

- PDF
- PNG
- JPG


Future:

- DXF
- DWG
- IFC


---

## 5.2 Canvas


Functions:

- Zoom
- Pan
- Grid
- Scale Setting
- Object Placement


---

## 5.3 Equipment Library


Initial equipment:

Vantive AK98


Future:

- Vantive models
- Fresenius
- Nipro
- B.Braun


---

## 5.4 Engineering Validation


Check:

- Service clearance
- Equipment collision
- Connection availability
- Maintenance access


---

## 5.5 Report Generator


Generate:

PDF Installation Review Report


Include:

- Project information
- Layout image
- Equipment list
- Engineering check
- Installation checklist


---

# 6. Non Functional Requirements


Performance:

Support 50 equipment objects minimum.


Data:

All engineering values must come from database.


Traceability:

Every rule requires source information.


---

# 7. Future Expansion


Version 2:

- RO routing
- Electrical routing
- Automatic layout


Version 3:

- AI design assistant
- BIM


Version 4:

- Digital Twin
