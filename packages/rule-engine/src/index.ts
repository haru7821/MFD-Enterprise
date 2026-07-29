/**
 * @mfd/rule-engine — engineering rule evaluation for MFD-E.
 *
 * Pure TypeScript. No React, no Konva, no NestJS, no Node built-ins, no DOM.
 *
 * The design principle from docs/rules/DIALYSIS_RULE_ENGINE_v0.1.md, restated
 * because it is the reason this package exists:
 *
 *   Incorrect:  if (distance < 1200)
 *   Correct:    load rule → validate → generate result
 *
 * Search this package for a millimetre figure and you will not find one. Every
 * number an evaluator compares against arrives from a rule file or an equipment
 * record, and every result names which.
 */

export * from './schema';
export * from './errors';
export * from './ruleSet';
export * from './threshold';
export * from './result';
export * from './sat';
export * from './evaluate';
export * from './evaluators/types';
export { evaluateClearance } from './evaluators/clearance';
export { evaluateCollision } from './evaluators/collision';
