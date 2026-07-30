import { type Catalog, createCatalog } from '../src/catalog';

import dialysisBed from './dialysis_bed.json';
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
 * **Manufacturer dimensions** — 585 × 620 × 1305 mm — were supplied by the product owner.
 * They replace the 900 × 750 mm that the object specification marked "Example" and that
 * this catalogue previously carried as its only footprint.
 *
 * **Design footprint** — 800 × 800 mm — is the planning area, also from the owner. It is
 * larger than the machine on purpose, and it is what every geometric check uses.
 *
 * The record is still `dataStatus: "draft"`, and that is not an oversight. `verified`
 * requires a document, a revision and a section, and none of those has been supplied:
 * these are the right numbers with no citation yet. `source.type` moved from `estimate`
 * to `datasheet`, which is a better description of owner-supplied manufacturer figures
 * than "estimate" was — but until the manual reference exists nothing computed from this
 * record can reach GREEN, and the service clearances are still null.
 *
 * `designFootprint.basis` is also null, which the schema separately requires for
 * `verified`: an 800 × 800 planning area needs one sentence saying why.
 *
 * ## On the dialysis bed
 *
 * A generic planning object: a 1,000 × 2,100 mm footprint with **no manufacturer and no
 * manufacturer dimensions at all**. That is the case the manufacturer/design split was
 * made for. Its connections are marked not required — a bed is not plumbed — which is a
 * statement about beds, not a placeholder.
 *
 * JSON has no comments and the schema rejects unknown keys, so these notes live here.
 */
export const catalog: Catalog = createCatalog([
  { fileName: 'vantive_ak98.json', raw: vantiveAk98 },
  { fileName: 'dialysis_bed.json', raw: dialysisBed },
]);

export { type Catalog };
