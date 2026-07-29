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
evaluate({ placements, catalog, ruleSet }): EvaluationReport
```

| Input | Type | From |
| --- | --- | --- |
| `placements` | `readonly Placement[]` | The project document |
| `catalog` | `Catalog` | `@mfd/object-library` — equipment records |
| `ruleSet` | `RuleSet` | `standards/rules/`, loaded and validated |

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
| Pass, every input `verified` | `GREEN` |
| Pass, any input `draft` | `YELLOW` |

Three deliberate choices, each of which someone will eventually want to change:

**There is no fourth status.** The specification defines three. An unevaluable rule
is exactly "review required", and a `NOT_EVALUATED` level would have to be handled
by every consumer for no gain.

**A violation is never softened for being provisional.** Downgrading a breach
because the figure behind it is a placeholder would make poor data *hide* problems.
The result carries `dataStatus`, so it reads as "breaches a provisional figure" —
which is information, not concealment.

**A pass needs verified inputs to reach GREEN** (AD-6a). A placeholder must never
be able to sign anything off.

### `dataStatus` propagation

The weaker of the rule's status and the equipment's, across the inputs actually
used. Collision findings inherit it too: an overlap computed from placeholder
footprints is a provisional overlap.

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
| Unimplemented scope (`boundary`) | `YELLOW` stating it is not evaluated yet |

The last one matters: a rule that silently produced nothing would be
indistinguishable from a rule everything passes.

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

### Declared, not implemented

| Extension point | Interface | Sprint |
| --- | --- | --- |
| Boundary (wall) collision | `BoundaryCollisionEvaluator` in `evaluators/types.ts` | 4 |
| `collision.parameters.scope: 'boundary'` | Accepted by the schema today | 4 |

The interface is fixed now, while the rest of the engine is fresh, so Sprint 4's
walls bind to a shape that was designed rather than one invented against whatever
the evaluator happened to need.

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
