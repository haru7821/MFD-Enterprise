# Rule Engine — Implementation Reference

> How `packages/rule-engine` implements
> [DIALYSIS_RULE_ENGINE_v0.1.md](DIALYSIS_RULE_ENGINE_v0.1.md).
> Delivered in Sprint 3.

## The flow

```
Placement ──┐
Catalogue ──┼──► evaluate() ──► EvaluationReport
Rule set  ──┘                    └─ EvaluationResult[]
```

`evaluate()` is pure — no clock, no randomness, no I/O. The same inputs always give
the same report. That is what lets the browser run it for live feedback while the
server runs it as the authority for a signed report, and lets the two be compared
(architecture decision AD-3).

## No threshold is written in code

Search this package for a millimetre figure and you will not find one. Every number
an evaluator compares against arrives from a rule file or an equipment record. This
is the specification's design principle, and it is worth restating as a test you can
apply to any future change:

> Incorrect: `if (distance < 1200)`
> Correct: load rule → validate → generate result

## Rule record

| Field | Type | Notes |
| --- | --- | --- |
| `ruleId` | lower_snake_case | Results are keyed by it; duplicates are rejected |
| `category` | `clearance` \| `collision` | Discriminates `parameters` |
| `description` | string | Shown to the engineer in the findings panel |
| `threshold` | number \| null | Null defers to the equipment record |
| `unit` | `mm` | |
| `status` | `draft` \| `verified` | |
| `severity` | `RED` \| `YELLOW` | The level a violation produces |
| `appliesTo` | `{ equipmentIds, categories }` | At least one required |
| `parameters` | `{ side }` or `{ scope }` | Per category |
| `source` | document · revision · section · type · lastUpdated | |

Fields are **required and nullable**, never optional. Forgetting a field must not
look the same as recording that its value is unknown. Unknown keys are rejected, so
`treshold` fails loudly rather than silently leaving the rule unbounded.

`status: "verified"` requires `document`, `revision` and `section`. Without that
check "verified" decays into a field somebody set optimistically.

## Threshold resolution

A clearance figure can come from two legitimate places:

| Source | Means |
| --- | --- |
| Equipment record | What this machine needs, from its manual |
| Rule | What must be satisfied here, from a hospital or local standard |

| Rule | Equipment | Applied | `thresholdOrigin` |
| --- | --- | --- | --- |
| null | 1000 | 1000 | `equipment` |
| 1200 | null | 1200 | `rule` |
| 1500 | 1200 | **1500** | `rule` |
| 800 | 1200 | **1200** | `equipment` |
| null | null | — | `none` → YELLOW |

The stricter figure governs. Satisfying the manual while breaching the hospital's own
standard is still a breach, and a rule written for a class of machines cannot carry
per-model figures. Every result records which source was applied.

## Result levels

| Situation | Level |
| --- | --- |
| No threshold from either source | **YELLOW**, "threshold unknown" |
| Violation | The rule's `severity` — **regardless of provenance** |
| Pass, all inputs verified | **GREEN** |
| Pass, any input draft | **YELLOW** |

Three deliberate choices:

**No fourth status.** The specification defines three levels. An unevaluable rule is
exactly "Review Required".

**A violation is never downgraded for being provisional.** Softening a breach because
the figure behind it is a placeholder would make poor data *hide* problems — the
wrong direction to fail in. The result carries `dataStatus`, so it reads as
"breaches a provisional figure".

**A pass needs verified inputs to reach GREEN** (AD-6a). A placeholder must never be
able to sign anything off.

`dataStatus` is the weaker of the rule's status and the equipment's. Collision
findings inherit it too: an overlap computed from placeholder footprints is a
provisional overlap.

## Geometry

Footprints rotate, so every test uses the actual rotated polygon. An axis-aligned
bounds test would report a collision between two machines turned 45° and comfortably
apart.

- **`polygonsOverlap`** — separating axis theorem, returning penetration depth.
  Exact edge contact is *not* an overlap: two machines pushed flat together are a
  clearance question, and firing here would flag every tidy layout.
- **`gapAlongNormal`** — free distance from a face to another polygon along the face
  normal. Returns null when the other polygon is behind or beside the face, which is
  a genuine "nothing there" rather than a distance of zero.

### Side convention — needs manufacturer confirmation

Left and right are taken from **an operator standing at the front, looking at the
machine**. With the front facing south, the operator looks north and their left is
west.

A manual that labels its sides from the service engineer's position *behind* the
machine would invert left and right, putting both side clearances on the wrong face
of every result. This cannot be settled from inside the code — only the document
settles it. **First item to check when the AK98 manual arrives.**

## Adding a rule

Edit JSON in `standards/rules/dialysis/`. No code changes. See
[standards/README.md](../../standards/README.md).

## Adding a rule *category*

1. Add the variant to the discriminated union in `src/schema.ts`
2. Add an evaluator in `src/evaluators/`
3. Dispatch it in `src/evaluate.ts`
4. Test rejection cases, plus rotation and translation invariance

## What is not implemented

| | Sprint |
| --- | --- |
| Boundary (wall) collision — `BoundaryCollisionEvaluator` is declared, not implemented | 4 |
| Connection availability (power, RO, drain reachable) | after the routing model |
| Maintenance access path | after the spatial model |

A rule with `scope: "boundary"` loads and reports YELLOW saying it is not evaluated
yet, rather than silently producing nothing — a rule that does nothing looks exactly
like a rule that passes.

## Tests

180 unit tests across the workspace, of which the rule engine holds 100. The ones
that matter most are the **invariants**: a layout's verdict is a fact about the
arrangement, not about where it sits or which way it is turned. Rotate the whole
layout 137° or move it a kilometre, and every result must be identical.

Those catch a class of bug the per-case tests miss entirely — a coordinate error
harmless at the origin, or a face normal correct only at zero rotation. Both would
pass every other test in the suite.
