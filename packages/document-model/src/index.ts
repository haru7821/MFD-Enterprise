/**
 * @mfd/document-model — the MFD-E project document.
 *
 * Pure TypeScript. No React, no Konva, no NestJS, no Node built-ins, no DOM, no clock.
 *
 * This package owns what a project *is*. Saving a review, generating a report,
 * sharing a project between engineers, an assistant proposing a layout, and a facility
 * twin kept in step with what was installed — all of them read this shape and differ
 * only in what they do with it. One definition, imported by the editor, the report
 * generator and the server alike.
 *
 * Four responsibilities:
 *
 * 1. **Define and validate** the document, so a file that would mislead an engineer
 *    fails to open rather than opening wrong.
 * 2. **Edit it through commands** that each carry their own inverse, so undo is exact
 *    and every change is expressible as data.
 * 3. **Map an imported drawing into model millimetres**, and refuse to pretend an
 *    uncalibrated plan can be measured.
 * 4. **Save and load**, with schema versioning present from the first file written.
 */

export * from './schema';
export * from './errors';
export * from './document';
export * from './commands';
export * from './history';
export * from './plan';
export * from './serialize';
