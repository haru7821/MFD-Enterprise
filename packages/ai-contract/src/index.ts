/**
 * @mfd/ai-contract — the vocabulary in which an AI request and an AI proposal are expressed.
 *
 * Pure TypeScript. No React, no Konva, no NestJS, no Node built-ins, no DOM — **and no AI.**
 *
 * That last one is the point of the name. This package holds requests, responses, the scoring model,
 * the installation plan, the schemas and the validator. It holds no model name, no prompt, no
 * token count and no HTTP client, and it would be equally valid if the other side of the interface
 * were a person rather than a program (AD-11).
 *
 * Search this package for a weight and you will not find one: the seven the owner approved are data
 * in `standards/scoring/dialysis.json`, and what is here is the shape they load into.
 *
 * Design: docs/architecture/AI_SERVICE_API.md · docs/architecture/AI_SYSTEM_ARCHITECTURE.md
 */

export * from './context';
export * from './evidence';
export * from './fingerprint';
export * from './scoring';
export * from './rationale';
export * from './requests';
export * from './responses';
export * from './client';
export * from './planner';
export * from './schema';
export * from './validate';
