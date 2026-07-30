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
| `name` | `{ ko, en }` — short title for a report row |
| `description` | `{ ko, en }` — the full requirement, read in the results panel |
| `threshold` | The figure, or null to defer to the equipment record |
| `unit` | `mm` |
| `status` | `draft` or `verified` |
| `severity` | `RED` or `YELLOW` — the level a violation produces |
| `appliesTo` | `equipmentIds` and/or `categories`; at least one is required |
| `parameters` | `{ side }` for clearance, `{ scope }` for collision |
| `source` | Document, revision, section, type, date |

### Both languages are required

`name` and `description` each carry `ko` and `en`, and the loader rejects a rule missing
either. The report is bilingual, so a rule with only English is a rule it cannot print.

The wording lives **here**, with the threshold and the citation, rather than in the report
generator. A rule's name is part of the rule — it is what the report prints beside the
verdict and what an engineer quotes to a customer — and a generator holding its own list of
names would let the two drift, in a signed document.

Finding sentences are different: they are composed from **reason codes** in
`packages/rule-engine/src/messages.ts`, because a finding is produced by an evaluator rather
than authored per rule. `RC-101` is the same finding whatever language it is read in. See
[docs/architecture/RULE_ENGINE_API.md](../docs/architecture/RULE_ENGINE_API.md).

## Checklists

`checklists/dialysis.json` holds the installation checklist's categories and their standing
items, bilingual, loaded and validated at module load the same way the rule set is.

It is here rather than compiled into the report engine for the same reason the thresholds are: a
commissioning step is engineering process data. As data, adding one is a pull request against a
JSON file that a TS engineer can read; compiled in, it would be a code change and a release.

The report combines these standing items with items **derived** from the findings and from
unsourced field groups, in the same categories. A checklist of only standing items ignores the
assessment; a checklist of only derived items is empty on a drawing with no equipment placed, and
a water loop still needs commissioning.

Full reference: [docs/rules/RULE_ENGINE_IMPLEMENTATION.md](../docs/rules/RULE_ENGINE_IMPLEMENTATION.md).
