/**
 * @mfd/layout-knowledge — engineering knowledge from real dialysis unit drawings.
 *
 * > Owner decision: *"Create a new package: packages/layout-knowledge … Extract reusable
 * > engineering knowledge rather than hard-coded layouts … The optimization engine must consume
 * > this knowledge package rather than embedding layout assumptions … Future drawings should
 * > enrich the knowledge base without requiring code changes. Do not start AI inference yet.
 * > Build the engineering knowledge layer first."*
 *
 * ## The one thing to understand before using it
 *
 * **This package is descriptive. `standards/` is normative.**
 *
 * A number here means *"this is what drawings showed"*. A number in `standards/` means *"this is
 * what a design must satisfy"*. The rule engine reads the second and never the first — there is no
 * import of this package anywhere in `@mfd/rule-engine`, and `boundaries.test.ts` in this package
 * asserts it stays that way.
 *
 * The reason is the product's whole premise. Fifteen hospitals spacing stations at 1,800 mm is not
 * a requirement; it is fifteen observations, which may be fifteen copies of one firm's template.
 * Allowed to decide a verdict it would become a rule nobody wrote, cited to nothing.
 *
 * ## The pipeline
 *
 * ```
 * dataset repo          knowledge/observations/*.json      knowledge/derived/*.json
 * (PDF, DWG, JPG)  ──►  one file per drawing set,      ──► nine files, one per kind,
 *  referenced,           written by an engineer            generated, never hand-edited
 *  never vendored        against dimension lines
 * ```
 *
 * Adding drawings is a data change: append observations, regenerate, commit. No code moves — which
 * is requirement 5, and `aggregation.test.ts` holds it by rebuilding every derived file and
 * comparing byte for byte.
 *
 * ## What it will not let you record
 *
 * There is no `estimate` in {@link OBSERVATION_METHODS}. If a drawing does not state a number and
 * it cannot be measured against an established scale, it does not go in. The gap is the answer, and
 * every query can return nothing.
 */

export * from './provenance';
export * from './schema';
export * from './aggregate';
export * from './query';
export * from './load';
