/**
 * @mfd/object-library — the equipment catalogue of MFD-E.
 *
 * Pure TypeScript. No React, no Konva, no NestJS, no Node built-ins, no DOM.
 *
 * Two responsibilities:
 *
 * 1. **Define and validate** equipment records, so a catalogue file that would
 *    mislead an engineer fails to load instead.
 * 2. **Turn a record plus a transform into millimetre geometry**, so the renderer
 *    never needs to know a machine's dimensions — it asks.
 */

export * from './schema';
export * from './errors';
export * from './catalog';
export * from './placement';
export * from './geometry';
