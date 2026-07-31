import type { Bilingual } from '@mfd/rule-engine';
import { REFERENCE_POINT_KINDS, type RefWithVersion } from '@mfd/ai-contract';
import { z } from 'zod';

/**
 * The installation sequence set — **data, not code**.
 *
 * Stage names, their order, what each verifies and what it needs live in
 * `standards/sequences/dialysis.json`, for the same reason the clearance thresholds and the
 * commissioning checklist do (AD-4): a customer whose site sequences differently edits a file, and
 * the change is reviewable as a change to engineering data rather than as a change to a solver.
 *
 * ## Applicability is data too
 *
 * A stage applies *when something in the project calls for it*, and the condition is declared in the
 * file rather than decided in TypeScript. `{"kind": "has_reference_point", "referencePointKind":
 * "ro_supply"}` is a sentence a reviewer can read; `if (points.some(p => p.kind === 'ro_supply'))`
 * buried in a planner is one they have to go looking for. The set of conditions is closed — three
 * kinds — so a file cannot introduce a predicate the planner does not understand.
 *
 * ## What the file may not contain
 *
 * A duration or a crew size with a number in it, unless somebody supplies a source for it. The
 * shipped file has `null` throughout and says so in a `rateAuthority` block, so every figure the
 * planner reports today is `unknown`. See AD-19 as amended, and B-7.
 */

const bilingualSchema = z.object({ ko: z.string().min(1), en: z.string().min(1) });

const applicabilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('always') }),
  z.object({ kind: z.literal('has_placements') }),
  z.object({
    kind: z.literal('has_reference_point'),
    referencePointKind: z.enum(REFERENCE_POINT_KINDS),
  }),
]);

export type StageApplicability = z.infer<typeof applicabilitySchema>;

const toolSchema = z.object({
  id: z.string().min(1),
  title: bilingualSchema,
  per: z.enum(['stage', 'station']),
  quantity: z.number().positive().nullable(),
  /**
   * The checklist item that makes this tool necessary.
   *
   * Required, and it is what keeps the tool list honest. A tool nobody can trace to a check is a
   * developer's guess at site practice; "you need a pressure gauge because `loop_pressure` says to
   * confirm loop pressure" is an entailment an engineer can agree or disagree with.
   */
  entailedBy: z.string().min(1),
});

const riskSchema = z.object({
  id: z.string().min(1),
  title: bilingualSchema,
  detail: bilingualSchema,
});

const stageSchema = z.object({
  id: z.string().min(1),
  title: bilingualSchema,
  dependsOn: z.array(z.string().min(1)),
  appliesWhen: applicabilitySchema,
  checklistItemIds: z.array(z.string().min(1)),
  tools: z.array(toolSchema),
  materials: z.array(toolSchema),
  risks: z.array(riskSchema),
  /** Null until somebody supplies a crew size with a source. See `rateAuthority`. */
  manpower: z.object({ persons: z.number().positive().nullable() }),
  rate: z.object({
    hoursFixed: z.number().positive().nullable(),
    hoursPerStation: z.number().positive().nullable(),
  }),
  /** True on the one stage the per-machine service connections belong to. */
  carriesServiceMaterials: z.boolean(),
});

export type SequenceStage = z.infer<typeof stageSchema>;

export const sequenceSetSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    title: bilingualSchema,
    checklistSet: z.object({ id: z.string().min(1), version: z.string().min(1) }),
    authority: z.object({}).loose(),
    rateAuthority: z.object({}).loose(),
    stages: z.array(stageSchema).min(1),
  })
  .refine((set) => new Set(set.stages.map((stage) => stage.id)).size === set.stages.length, {
    message: 'stage ids must be unique',
  })
  .refine(
    (set) => {
      const ids = new Set(set.stages.map((stage) => stage.id));
      return set.stages.every((stage) => stage.dependsOn.every((id) => ids.has(id)));
    },
    { message: 'every dependsOn must name a stage in this file' },
  )
  .refine((set) => !hasCycle(set.stages), {
    /*
     * A cycle is not orderable, and the failure has to happen **at load** rather than the first
     * time somebody asks for a plan on a customer site. This is the same reasoning as validating
     * the scoring model at module load: bad engineering data should stop the application starting.
     */
    message:
      'the stage dependencies contain a cycle: a sequence that requires A before B and B before ' +
      'A cannot be executed, and no ordering of it is meaningful',
  })
  .refine((set) => set.stages.filter((stage) => stage.carriesServiceMaterials).length === 1, {
    message:
      'exactly one stage must carry the per-machine service connections: zero would drop them ' +
      'from the bill of materials, and two would order them twice',
  });

export type SequenceSet = z.infer<typeof sequenceSetSchema>;

/** The set's identity, for `InstallationPlan.sequenceSet`. */
export function sequenceSetRef(set: SequenceSet): RefWithVersion {
  return { id: set.id, version: set.version };
}

/** Depth-first cycle detection over the declared dependencies. */
function hasCycle(stages: readonly SequenceStage[]): boolean {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const state = new Map<string, 'open' | 'closed'>();

  function visit(id: string): boolean {
    const mark = state.get(id);
    if (mark === 'closed') return false;
    if (mark === 'open') return true;

    state.set(id, 'open');
    for (const next of byId.get(id)?.dependsOn ?? []) {
      if (visit(next)) return true;
    }
    state.set(id, 'closed');
    return false;
  }

  return stages.some((stage) => visit(stage.id));
}

export type { Bilingual };
