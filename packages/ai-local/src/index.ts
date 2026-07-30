/**
 * @mfd/ai-local — the deterministic layout solver.
 *
 * Pure TypeScript. No React, no Konva, no NestJS, no Node built-ins, no DOM — **and no model.**
 *
 * Placing twelve stations in a room subject to clearance and access constraints is a packing
 * problem with the rule engine as its oracle, not a language problem. A solver does it
 * reproducibly, offline, in milliseconds, and can say exactly why it chose what it chose.
 *
 * Step 3 delivers generation and the two hard gates. Scoring is step 4, and the seam between them
 * is the architecture: **a candidate that failed a gate never reaches the scoring engine.**
 *
 * Design: docs/architecture/AI_WORKFLOW.md § D · docs/architecture/AI_SYSTEM_ARCHITECTURE.md § C-4
 */

export * from './candidates';
export * from './gates';
export * from './generate';
