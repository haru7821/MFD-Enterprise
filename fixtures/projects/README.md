# Project fixtures

Whole `.mfd.json` project files, checked in as **files** rather than built by a fixture function.

That distinction is the point. A fixture function is written against today's schema and moves with
it: delete a field from `Level` and every function-built fixture silently stops carrying it. A file
does not move. `migration/v3-project.json` is what a version 3 build actually wrote, and it stays
that way however far the schema travels — which is the only way to test that a real project saved
by an older version still opens.

## `migration/v3-project.json`

A dialysis ward as document version 3 saved it, for the owner's Hardening priority 2:

> *"A project created with the previous version can be opened and exported by the current version."*

Two levels, so the migration has to touch more than one: a calibrated 3F treatment floor with two
rooms, a wall, a structural column, eight AK98 stations and a bed; and an uncalibrated B1 plant room
with a boundary, a room and no equipment.

Deliberate properties, each of which some test depends on:

| Property | Why |
| --- | --- |
| `documentVersion: 3`, and **no** `referencePoints` on any level | Otherwise it is not a v3 file and every migration test is vacuous. `migration.test.ts` asserts this rather than trusting it. |
| `project.settings` present | Settings arrive in v3, so a genuine v3 file has them. |
| `obstructionType` present on every boundary | It arrives in v2, so a v3 file carries it. The column is typed `column`, not `other`. |
| `equipmentObjectVersion` older than the catalogue's current version | 0.2.0 for the AK98, 0.1.0 for the bed. A migration must not refresh the version a report cited — the placement records what was placed, not what is current. |
| A rotated and a mirrored placement | Transform fields that a careless migration could normalise away. |
| An uncalibrated second level | `coordinateMapping: null` is a valid state and must survive as null rather than being filled in. |
| A 1 × 1 px plan image | The fixture is about structure, not pixels, and a real scan would add megabytes of base64 to every checkout. The data URL is real and the calibration maths against it is consistent (5 mm/px from a 2,400 mm span over 480 px). |
| Korean names throughout | The project is bilingual, and a migration that mangled encoding would otherwise pass every test. |

**Not a real hospital.** The name, site and contact are invented. No customer drawing or customer
data is committed here.
