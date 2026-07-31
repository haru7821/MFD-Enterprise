/**
 * @mfd/ai-planner — the deterministic installation planner.
 *
 * Pure TypeScript. No React, no Konva, no NestJS, no Node built-ins, no DOM — **and no model.**
 *
 * > Owner decision, Sprint 6: *"Sprint 6 is NOT an 'AI generation' sprint. It is an Engineering
 * > Planning Engine … The planner explains engineering decisions and generates installation
 * > workflows from validated layouts."*
 *
 * Sequencing an installation is a dependency-ordering problem: the loop is pressure tested before
 * anything is connected to it, power is energised before commissioning, the floor is finished before
 * anything is anchored to it. Those are edges in a graph, and a topological order over them is
 * exact, reproducible and explicable by naming the edge — none of which is true of an answer
 * produced by prediction.
 *
 * Two properties are held by types rather than by discipline:
 *
 * - **Only validated layouts.** `PlanInput.evaluation` is required, so an unevaluated drawing
 *   cannot be turned into a plan input at all.
 * - **Offline.** `AiPlanner.requiresNetwork` is the literal `false`, so an implementation that
 *   needed a network could not satisfy the interface.
 *
 * Design: docs/architecture/AI_SYSTEM_ARCHITECTURE.md § C-3
 */

export * from './sequenceSet';
export * from './stages';
export * from './order';
export * from './connections';
export * from './materials';
export * from './effort';
export * from './blockers';
export * from './plan';
