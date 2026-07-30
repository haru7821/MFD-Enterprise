# Rule Engine API

> The published interface of `@mfd/rule-engine`.
> **Evaluation result contract frozen at version 1 in Sprint 3.5.**
>
> Implementation notes: [RULE_ENGINE_IMPLEMENTATION.md](../rules/RULE_ENGINE_IMPLEMENTATION.md).
> Rule authoring: [standards/README.md](../../standards/README.md).

## Why this is frozen

Three callers will read the same result, and they must agree:

1. **The browser**, for live feedback while an engineer drags a machine.
2. **The server** in Sprint 5, as the authority for a signed report.
3. **The report generator**, turning findings into a document a hospital receives.

A field added in one place and missing in another surfaces as a report that
contradicts the screen it came from. So the shape is locked by
`src/result.shape.test.ts`, which asserts the **exact** key set — an added field
fails the build. Changing the contract means changing the shape, updating that
test, and bumping `EVALUATION_RESULT_VERSION`. All three, deliberately.

---

## Input model

```ts
evaluate({ placements, catalog, ruleSet, spatial? }): EvaluationReport
```

| Input | Type | From |
| --- | --- | --- |
| `placements` | `readonly Placement[]` | The project document |
| `catalog` | `Catalog` | `@mfd/object-library` — equipment records |
| `ruleSet` | `RuleSet` | `standards/rules/`, loaded and validated |
| `spatial` | `SpatialContext` (optional) | The level's boundaries and plan status |

`spatial` was added in Sprint 4. It is optional so a caller with no building — a bare
layout check, or the Sprint 3 call sites — needs no change; omitting it means no
boundaries and `planStatus: 'none'`. **The result contract did not change, so
`EVALUATION_RESULT_VERSION` stays at 1.**

### SpatialContext

| Field | Type | Notes |
| --- | --- | --- |
| `boundaries` | `readonly Boundary[]` | Room outlines, walls and obstructions on this level |
| `planStatus` | `'none' \| 'calibrated' \| 'uncalibrated'` | Whether the drawing beneath the layout can be measured against |

`evaluate` is **pure**: no clock, no randomness, no I/O, no globals. The same
inputs always produce the same report, byte for byte. That is what makes the
browser result and the server result comparable rather than merely similar.

### Placement

One machine on the drawing. Defined in
[PROJECT_MODEL.md](../data-model/PROJECT_MODEL.md).

| Field | Notes |
| --- | --- |
| `id` | Referenced by results |
| `equipmentObjectId` | Points into the catalogue; never a copy of it |
| `equipmentObjectVersion` | Which catalogue version was placed |
| `transform` | `{ position, rotation (millidegrees), mirrored }` |
| `label` | Shown to the engineer |

A placement whose `equipmentObjectId` is not in the catalogue is **skipped**, not
an error: it is a data problem for the application to surface, and refusing to
evaluate the other forty-nine machines would help nobody.

### The calibration gate

`planStatus: 'uncalibrated'` means a drawing was imported and never given a coordinate
mapping. Machines placed against it sit where somebody eyeballed them on screen. Their
geometry *relative to one another* is still real, but nothing about the **building** has
been checked, so no result may be GREEN.

| Level | On an uncalibrated plan |
| --- | --- |
| GREEN | Becomes **YELLOW**, with the reason extended to say why |
| YELLOW | Unchanged |
| RED | **Unchanged.** A violation is never softened for weak provenance |

`'none'` — no drawing at all — is not a weaker case than `'calibrated'`. An engineer
laying a room out in millimetres with no drawing behind it has exact geometry. It is the
half-imported plan that is dangerous, because it *looks* like a measured drawing.

### Rule

Defined in [schema.ts](../../packages/rule-engine/src/schema.ts).

| Field | Type | Notes |
| --- | --- | --- |
| `ruleId` | `string` | lower_snake_case, unique across the set |
| `category` | `'clearance' \| 'collision'` | Discriminates `parameters` |
| `description` | `string` | Shown in the findings panel |
| `threshold` | `number \| null` | Null defers to the equipment record |
| `unit` | `'mm'` | |
| `status` | `'draft' \| 'verified'` | |
| `severity` | `'RED' \| 'YELLOW'` | The level a violation produces |
| `appliesTo` | `{ equipmentIds, categories }` | At least one non-null |
| `parameters` | `{ side }` \| `{ scope }` | Per category |
| `source` | provenance | See below |

---

## Output model

### EvaluationReport

| Field | Type | Notes |
| --- | --- | --- |
| `ruleSetId` | `string` | Stamped so a finding can be reproduced later |
| `ruleSetVersion` | `string` | |
| `results` | `readonly EvaluationResult[]` | Ordered worst first |
| `counts` | `{ GREEN, YELLOW, RED }` | Sums to `results.length` |
| `hasDraftInputs` | `boolean` | True when any result rests on provisional data |

### EvaluationResult

| Field | Type | Notes |
| --- | --- | --- |
| `ruleId` | `string` | |
| `category` | `'clearance' \| 'collision'` | |
| `level` | `'GREEN' \| 'YELLOW' \| 'RED'` | |
| `placementIds` | `readonly string[]` | **`[0]` is always the subject of the finding.** One id for a clearance finding or a clear collision check; two when a collision names the machine involved. |
| `measured` | `number \| null` | Free distance, or overlap depth. Null when there was nothing to measure against |
| `appliedValue` | `number \| null` | The threshold actually applied |
| `thresholdOrigin` | `'rule' \| 'equipment' \| 'none'` | Which source supplied it |
| `unit` | `'mm'` | |
| `dataStatus` | `'draft' \| 'verified'` | The weakest input actually used |
| `reason` | `string` | A sentence an engineer can read without opening the rule file |
| `source` | `{ document, revision, section, type, lastUpdated }` | Carried from the rule |

**Everything is JSON-safe.** No `Date`, no `Map`, no `undefined`, no functions —
the contract crosses a network boundary in Sprint 5, and anything that does not
survive `JSON.stringify` is not part of it. A round-trip test enforces this.

`measured` and `appliedValue` are `null`, never absent. An omitted field and an
unknown value must not look the same.

### Collision findings are equipment-centred

A collision result is about **one machine**, named by `placementIds[0]`. A collision
between two machines therefore produces two findings, one anchored on each — an
engineer inspecting either machine has to see the problem.

| Concept the caller needs | Contract field |
| --- | --- |
| Which machine the finding is about | `placementIds[0]` |
| The machine it collides with | `placementIds[1]`, absent when clear |
| Issue type | `category` |
| Penetration depth in millimetres | `measured`, null when clear |

No field was added for this: the contract already carried all four, so
`EVALUATION_RESULT_VERSION` stays at 1.

### Boundary findings

Also equipment-centred, and also one finding per machine. A machine reports one result if
it is inside its room and clear of every obstruction, or one per problem otherwise.

| Situation | Level | `measured` |
| --- | --- | --- |
| Inside its room, clear of obstructions | pass | `null` |
| Extends past the room outline | violation | how far past, mm |
| Inside no room outline at all | violation | `null` |
| Overlaps a wall or obstruction | violation | overlap depth, mm |
| No boundaries drawn | YELLOW | `null`, and the reason says nothing was checked |

**Which room a machine is judged against** is its *home room*: the outline containing its
centre, or failing that the one containing the most of its corners. A machine in room A is
trivially outside room B, so "inside every room" is not the question — "inside the room it
is in" is. A machine in no room is a violation, not a pass: an engineer who has drawn the
rooms and left a machine in the corridor needs to see that.

**Overlap depth is measured in both directions**, because either shape can be the one
doing the engulfing. A machine straddling the edge of a column has no corner inside the
column — the column's corners are inside the machine. It is `null` when no vertex of
either lies inside the other, which is what a machine spanning a thin partition looks
like: a real overlap with no well-defined depth, where reporting zero would read as "just
touching".

**A traced boundary does not affect `dataStatus`.** That field tracks the provenance of
*engineering standards* — a manufacturer's clearance figure against a placeholder. A room
outline is project data the engineer traced themselves, and its reliability is the
calibration's, which the gate above handles rather than pretending a traced wall is a
draft manual figure.

The alternative — one finding per *pair* — was the first implementation and was
replaced. It produced 1,225 findings for fifty machines, almost all of them saying
two machines do not overlap, which fails as a report before it fails as
performance. `collisionVolume.test.ts` asserts that findings grow linearly with
machine count so the quadratic shape cannot return unnoticed.

---

## Status definitions

### Rule and equipment status

| Value | Means |
| --- | --- |
| `draft` | The figures are provisional. No manual reference is required. |
| `verified` | The figures come from a named document. `source.document`, `revision` and `section` are **required** — the loader rejects a record claiming otherwise. |

Without that check, `verified` decays into a field somebody set optimistically.

A rule carries one status for the whole record. An **equipment** record carries one per
field group — dimensions, service clearance, each connection, environmental — so verified
and draft data coexist in one object and a verified figure is never downgraded because a
different figure is unknown. See
[../data-model/OBJECT_MODEL.md](../data-model/OBJECT_MODEL.md).

### Result levels

Per [DIALYSIS_RULE_ENGINE_v0.1.md](../rules/DIALYSIS_RULE_ENGINE_v0.1.md):

| Level | Means |
| --- | --- |
| `GREEN` | OK |
| `YELLOW` | Review required |
| `RED` | Not acceptable |

How a level is decided:

| Situation | Level |
| --- | --- |
| No threshold from rule or equipment | `YELLOW`, reason "threshold unknown" |
| Violation | The rule's `severity`, **whatever the provenance** |
| Pass, every input actually read is `verified` | `GREEN` |
| Pass, any input actually read is `draft` | `YELLOW` |

Three deliberate choices, each of which someone will eventually want to change:

**There is no fourth status.** The specification defines three. An unevaluable rule
is exactly "review required", and a `NOT_EVALUATED` level would have to be handled
by every consumer for no gain.

**A violation is never softened for being provisional.** Downgrading a breach
because the figure behind it is a placeholder would make poor data *hide* problems.
The result carries `dataStatus`, so it reads as "breaches a provisional figure" —
which is information, not concealment.

**A pass needs verified inputs to reach GREEN** (AD-6a). A placeholder must never
be able to sign anything off — but only the placeholders the conclusion rested on. The
table above is the whole list of what each evaluator reads, and it exists so this rule can
be applied precisely rather than defensively.

### `dataStatus` propagation

The weaker of the rule's status and the status of **each equipment field group the
evaluator actually read**. Equipment verification is per group (Phase 4.5), so this is a
short and explicit list rather than a property of the record:

| Evaluator | Equipment groups read | `dataStatus` |
| --- | --- | --- |
| Clearance, `thresholdOrigin: 'equipment'` | `serviceClearance` | Weaker of the rule's status and that group's |
| Clearance, `thresholdOrigin: 'rule'` | none | The rule's status |
| Equipment collision | none — design footprints only | The rule's status |
| Boundary collision | none — footprint and traced geometry | The rule's status |

**Collision findings no longer inherit the record's status**, and that is the change. A
design footprint is an owner-defined planning property with no manufacturer citation, so
"these two machines overlap by 500 mm" is a fact about two rectangles; an unsourced service
clearance elsewhere in the same record does not soften it. Under the previous record-level
model it did, which meant a single unknown field made every geometric finding on that machine
provisional — and an engineer who had sourced everything except the clearances saw the same
amber warning as one who had sourced nothing.

`weakestStatus(ruleStatus)` with no equipment argument is therefore a **meaningful** call,
not a degenerate one: it says this conclusion read no equipment figure.

---

## Error handling

The engine distinguishes three failure kinds, and treats them very differently.

### 1. Bad data — throws, loudly, at load

| Error | When |
| --- | --- |
| `RuleValidationError` | A rule record fails the schema. Carries `fileName` and every bad field path. |
| `DuplicateRuleIdError` | Two rules share an id. Carries both file names. |
| `CatalogValidationError` | An equipment record fails the schema (from `@mfd/object-library`). |

`createRuleSet` fails on the **first** invalid record and does not build a partial
set. A rule set that quietly dropped a bad rule would produce a report missing a
requirement, with nothing anywhere saying so — the worst available outcome for a
document whose purpose is to be relied on.

Loading happens at module load, so a malformed rule stops the application starting
rather than surfacing the first time an engineer places the machine it governs.

Messages name the file and the field, because the person fixing a broken rule is an
engineer transcribing an installation manual, not the developer who wrote the
loader.

### 2. Missing data — a result, not an exception

| Situation | Behaviour |
| --- | --- |
| No threshold available | `YELLOW`, "threshold unknown" |
| Nothing in front of the face | Pass, `measured: null`, reason says so |
| Rule selects no placement | No results for that rule |
| Boundary rule, no boundaries drawn | `YELLOW` saying nothing was checked |
| A scope with no evaluator | `YELLOW` naming the scope |

The last two matter: a rule that silently produced nothing would be indistinguishable
from a rule everything passes.

### 3. Inconsistent references — skipped, and surfaced by the caller

A placement pointing at a catalogue record that no longer exists is skipped by
`evaluate` and rendered as a problem by the application. The engine does not throw:
one stale reference should not take down validation of the whole floor.

### What never throws

`evaluate` itself. Given a loaded rule set and catalogue, it always returns a
report. Every partial or unknown condition is expressed as a result, because a
validator that crashes tells the engineer nothing about the other forty-nine
machines.

---

## Future extension points

### Adding a rule category

1. Add the variant to the discriminated union in `src/schema.ts`
2. Add an evaluator under `src/evaluators/`
3. Dispatch it in `src/evaluate.ts`
4. Test rejection cases plus rotation and translation invariance

The result contract does not change, so consumers need no update.

### Implemented in Sprint 4

| Extension point | Interface | Status |
| --- | --- | --- |
| Boundary (wall) collision | `BoundaryCollisionEvaluator` in `evaluators/types.ts` | ✅ `evaluators/boundary.ts` |
| `collision.parameters.scope: 'boundary'` | Accepted by the schema since Sprint 3 | ✅ dispatched in `evaluate.ts` |

Worth recording, because it is the case for declaring interfaces before their
implementations: the `BoundaryCollisionEvaluator` shape was fixed in Sprint 3, before any
walls existed. When the spatial model arrived it bound to the document model's `Boundary`
**without the interface changing** — the only edit was replacing a structural stand-in for
the polygon with the real record.

### Not yet designed

| Need | Blocked on |
| --- | --- |
| Connection availability (power, RO, drain reachable) | The routing model |
| Maintenance access path | The spatial model |
| Per-project rule overrides (a hospital's stricter standard) | AD-4's override layer; the schema already carries `source`, so an override can state where it came from |
| Rule set selection by jurisdiction | AD-6; `RuleSet` already has `id` and `version` to select on |

### A note on scale

`evaluate` is O(n²) in the collision pass. That is comfortable at the
specification's fifty objects and stops being comfortable at a few hundred — see
[PERFORMANCE_TEST_PLAN.md](../testing/PERFORMANCE_TEST_PLAN.md) for measured
figures and the point at which spatial indexing becomes worth its complexity.
