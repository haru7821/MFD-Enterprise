import { type Catalog, createCatalog } from '../src/catalog';

import vantiveAk98 from './vantive_ak98.json';

/**
 * The shipped equipment catalogue.
 *
 * Records are imported statically rather than discovered at runtime: a bundler can
 * see every file, the set is checked at build time, and adding a machine is a
 * visible one-line change rather than a filesystem side effect.
 *
 * Validation runs at module load. A malformed record therefore fails the moment the
 * application starts, not the first time an engineer tries to place that machine.
 *
 * ## On the AK98 figures
 *
 * Its 900 × 750 mm footprint comes from the object specification, where it is marked
 * "Example". It is a placeholder, not a measurement, which is why the record carries
 * `dataStatus: "draft"` and `source.type: "estimate"`, and why every other
 * engineering value is null. JSON has no comments and the schema rejects unknown
 * keys, so this note lives here.
 */
export const catalog: Catalog = createCatalog([
  { fileName: 'vantive_ak98.json', raw: vantiveAk98 },
]);

export { type Catalog };
