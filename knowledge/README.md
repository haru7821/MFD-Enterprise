# knowledge/ — what drawings showed

Beside `standards/`, and deliberately not inside it.

| Directory | Answers | Decides a verdict |
| --- | --- | --- |
| `standards/` | *What must this design satisfy?* | **Yes** — the rule engine reads it |
| `knowledge/` | *What did other units do?* | **No** — nothing here can produce a finding |

That separation is the whole point, and it is enforced rather than described:
`packages/layout-knowledge/src/boundaries.test.ts` fails if `@mfd/rule-engine`, `@mfd/report-engine`,
`@mfd/ai-planner`, `@mfd/document-model` or `@mfd/object-library` ever imports the knowledge package.

Fifteen hospitals spacing their stations at 1,800 mm does not make 1,800 mm a requirement. It may be
what the equipment of the day needed, what the rooms happened to allow, or fifteen copies of one
firm's template. Allowed to decide a verdict it would become a rule nobody wrote, cited to nothing.

## Layout

```
knowledge/
  dataset.json            the drawing repository, referenced by commit — never vendored
  observations/*.json     one file per drawing set, written by an engineer
  derived/*.json          nine files, one per kind — generated, never hand-edited
```

## The dataset repository

`haru7821/MFD-Hospital-Dataset`, external and referenced by commit. **Not vendored** — a large
collection of real hospital drawings does not belong in an application's history, where it could
not be removed later, and copying sheets here would fork them from the set an engineer maintains.

```
MFD-Hospital-Dataset/
  dataset/
    Hospital_001/     PDF · DWG/DXF · images · optional README
    Hospital_002/
    ...
```

Catalogue it with `pnpm dataset:ingest -- --dataset <checkout> --commit <sha>`. That reads every
file, hashes it, reads page count, page size and PDF metadata, computes the resolution the importer
will actually rasterise it at, and classifies it against the taxonomy in
`docs/verification/DRAWING_IMPORT_VERIFICATION.md`. Nothing is copied.

Two classifications are deliberately provisional. `photograph_suspected` is a flag for a human,
because perspective distortion cannot be detected from a raster and a photograph calibrates
plausibly while measuring wrongly everywhere away from the calibration line. `unreadable` is what an
unopenable file gets, never a guess at what it might have been.

## Adding drawings

This is a **data change**. No code moves — that is requirement 5 of the owner's decision, and
`boundaries.test.ts` holds it by rebuilding every derived file and comparing byte for byte.

1. Add the drawings to `dataset.json` with their paths, formats and hashes.
2. Write an observation file recording what the drawings **state**. Every reading needs a method
   from `OBSERVATION_METHODS`: a printed dimension, a schedule, an annotation, or a measurement
   taken against a scale that was established first.
3. Regenerate: `pnpm knowledge:build`.
4. Commit the observations and the regenerated derived files together.

### What must not be recorded

There is no `estimate` method, and there will not be one. If a drawing does not state a figure and
it cannot be measured against a known scale, it is not recorded. The gap is the answer — every query
can return nothing, and every consumer has to handle that.

An eyeballed number off an uncalibrated PDF is indistinguishable from a measured one once it is in
the file, which is exactly why the file will not accept it.

## The state today

**Empty.** The dataset repository has not been provided, `dataset.json` catalogues no drawings, and
every derived file holds `entries: []`.

This is visible in the running application rather than hidden: the solver's
`installation_feasibility` criterion reports `SC-905`, *"no figure for it has been observed in the
drawing dataset"*, because the delivery crate allowance it needs used to be a 150 mm constant
written into the solver and is now read from here. Coverage is correspondingly lower — and honest,
where before it counted an invented number as evidence.
