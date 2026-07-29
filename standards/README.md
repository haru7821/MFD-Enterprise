# standards/

Medical and manufacturer engineering rules, as versioned data.

CLAUDE.md: *"Never hard-code engineering rules. Load rule from `/standards/rules`."*
This directory is that path.

```
standards/
└── rules/
    └── dialysis/
        ├── equipment_clearance.json
        └── equipment_collision.json
```

## Why the rules live in git rather than only in the database

Regulation and manual text needs history, review and blame. Git gives all three: a
changed clearance figure shows up in a diff, with an author and a date, and the project
that was assessed under the old figure can be reproduced. A table row gives none of that.
PostgreSQL becomes a queryable mirror of these files, plus a place for per-project
overrides — see architecture decision AD-4.

## Every threshold is currently null

The Vantive AK98 installation manual has not been supplied, so no clearance figure in this
directory is true. Rather than invent plausible numbers, the records carry
`"threshold": null` and `"status": "draft"`.

In the running application this shows as a YELLOW result reading "threshold unknown". That
is a validator honestly reporting that it has nothing to validate against, and it is
preferable to a GREEN produced by a number somebody guessed.

## Filling in a real figure

When the manual arrives, one file changes and no code does:

```jsonc
{
  "ruleId": "ak98_front_clearance",
  "threshold": 1200,                             // the figure from the manual
  "status": "verified",                          // now defensible
  "source": {
    "document": "AK 98 Installation Manual",     // required when verified
    "revision": "Rev. 4",                        // required when verified
    "section": "3.2 Installation clearances",    // required when verified
    "type": "manufacturer_manual",
    "lastUpdated": "2026-08-15"
  }
}
```

The loader **rejects** a record marked `verified` whose `document`, `revision` or
`section` is missing. Without that check "verified" would decay into a field somebody set
optimistically, and TS Edition specification section 6 requires every rule to carry source
information.

Equipment dimensions and manufacturer service clearances are separate data and live in
`packages/object-library/catalog/`. Where both a rule and an equipment record give a figure
for the same side, the stricter one is applied and the result records which — see
`packages/rule-engine/src/threshold.ts`.

## Rule fields

| Field | Meaning |
| --- | --- |
| `ruleId` | Unique, lower_snake_case. Results are keyed by it, so duplicates are rejected. |
| `category` | `clearance` or `collision` |
| `description` | Read by the engineer in the results panel |
| `threshold` | The figure, or null to defer to the equipment record |
| `unit` | `mm` |
| `status` | `draft` or `verified` |
| `severity` | `RED` or `YELLOW` — the level a violation produces |
| `appliesTo` | `equipmentIds` and/or `categories`; at least one is required |
| `parameters` | `{ side }` for clearance, `{ scope }` for collision |
| `source` | Document, revision, section, type, date |

Full reference: [docs/rules/RULE_ENGINE_IMPLEMENTATION.md](../docs/rules/RULE_ENGINE_IMPLEMENTATION.md).
