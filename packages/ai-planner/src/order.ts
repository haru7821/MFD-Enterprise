import type { SequenceStage } from './sequenceSet';

/**
 * The installation order.
 *
 * A topological sort, and the reason the planner is deterministic TypeScript rather than a model:
 * *"which comes first, the pressure test or the equipment set?"* is a question about edges in a
 * graph. The answer is exact, it is the same every time, and it can be explained by naming the
 * edge — none of which is true of an answer produced by prediction.
 *
 * ## Ties break on the file, not on chance
 *
 * Two stages with no dependency between them can print in either order without contradicting
 * anything, so something has to choose. This takes them in the order the sequence file declares
 * them: an engineer who wants the electrical work before the water work reorders the file, and the
 * plan follows. Kahn's algorithm with a queue seeded in file order gives exactly that, and it gives
 * it stably — the same file always produces the same plan.
 *
 * A `Set` iteration or an object-key order would also be "deterministic" in the sense of
 * reproducible, and would express nothing. This expresses the file's intent.
 */

export class CyclicSequenceError extends Error {
  constructor(readonly stageIds: readonly string[]) {
    super(
      `the installation sequence contains a cycle among ${stageIds.join(', ')}: a plan that ` +
        `requires each of two stages before the other cannot be executed, and emitting some order ` +
        `anyway would leave the contradiction to be discovered on site`,
    );
    this.name = 'CyclicSequenceError';
  }
}

/**
 * Order the stages so every stage follows everything it depends on.
 *
 * Throws on a cycle rather than returning a partial order. The sequence file is validated at load,
 * so a cycle here means one was introduced by the rewiring — which would be a bug in this package
 * and must not be papered over with a plausible-looking sequence.
 */
export function orderStages(stages: readonly SequenceStage[]): SequenceStage[] {
  const present = new Set(stages.map((stage) => stage.id));
  const remaining = new Map(stages.map((stage) => [stage.id, new Set(stage.dependsOn.filter((id) => present.has(id)))]));
  const dependents = new Map<string, string[]>();

  for (const stage of stages) {
    for (const dependency of stage.dependsOn) {
      if (!present.has(dependency)) continue;
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), stage.id]);
    }
  }

  const emitted = new Set<string>();
  const ordered: SequenceStage[] = [];

  while (ordered.length < stages.length) {
    /*
     * The **earliest in file order** among everything currently ready — not the first thing that
     * became ready.
     *
     * A queue would also terminate and would also be reproducible, but the order it produced would
     * be an artefact of when each stage's last prerequisite cleared. This way, two stages that
     * could legitimately go in either order go in the order somebody wrote them down, and an
     * engineer who wants the electrical work before the water work moves it up the file.
     */
    const next = stages.find(
      (stage) => !emitted.has(stage.id) && (remaining.get(stage.id)?.size ?? 0) === 0,
    );

    if (!next) {
      const stuck = stages.filter((stage) => !emitted.has(stage.id)).map((stage) => stage.id);
      throw new CyclicSequenceError(stuck);
    }

    emitted.add(next.id);
    ordered.push(next);

    for (const dependent of dependents.get(next.id) ?? []) {
      remaining.get(dependent)?.delete(next.id);
    }
  }

  return ordered;
}
