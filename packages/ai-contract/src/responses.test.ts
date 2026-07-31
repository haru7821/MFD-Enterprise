import { describe, expect, it } from 'vitest';

import { fixturePassage, fixturePlan, fixtureScoreBreakdown } from '../fixtures';
import {
  aiProposalSchema,
  installationPlanSchema,
  retrievalResultSchema,
} from './schema';
import { PROPOSED_COMMAND_TYPES } from './responses';
import { RATIONALE_CODES } from './rationale';

describe('InstallationPlan', () => {
  it('accepts a plan whose printed order satisfies its dependencies', () => {
    expect(installationPlanSchema.safeParse(fixturePlan()).success).toBe(true);
  });

  it('rejects a dependency on a stage that is not in the plan', () => {
    const plan = fixturePlan();
    const stages = plan.stages.map((stage) =>
      stage.id === 'equipment_set' ? { ...stage, dependsOn: ['floor_finish'] } : stage,
    );
    expect(installationPlanSchema.safeParse({ ...plan, stages }).success).toBe(false);
  });

  it('rejects a dependency cycle', () => {
    // A cycle is not orderable. The planner must say so rather than emit some order and leave the
    // ambiguity to be discovered on site.
    const plan = fixturePlan();
    const stages = plan.stages.map((stage) =>
      stage.id === 'services_rough_in' ? { ...stage, dependsOn: ['commissioning'] } : stage,
    );
    const result = installationPlanSchema.safeParse({ ...plan, stages });
    expect(result.success).toBe(false);
  });

  it('rejects an order that contradicts a dependency, even with no cycle', () => {
    // The subtler failure, and the reason the check is on the printed order rather than only on
    // acyclicity: this graph is perfectly acyclic and prints commissioning before the equipment it
    // commissions.
    const plan = fixturePlan();
    const stages = plan.stages.map((stage) =>
      stage.id === 'commissioning' ? { ...stage, order: 0 } : stage,
    );
    const result = installationPlanSchema.safeParse({ ...plan, stages });
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/contradicts its own prerequisites/);
  });

  it('rejects duplicate stage ids', () => {
    const plan = fixturePlan();
    const first = plan.stages[0];
    if (first === undefined) throw new Error('fixture has no stages');
    expect(
      installationPlanSchema.safeParse({ ...plan, stages: [...plan.stages, first] }).success,
    ).toBe(false);
  });

  it('carries a duration that cannot be a bare number', () => {
    /*
     * AD-19, amended. The old assertion here was that `durationDays` was absent, which the owner's
     * Sprint 6 § 3 now asks for — so the refusal moved rather than lifting.
     *
     * A duration is a `SourcedNumber`: it has a status and a source, and EV-2 makes an uncited one
     * unrepresentable. The shipped standards data supplies no labour rate, so every figure today is
     * `unknown` — the same answer as before, from a mechanism that can produce a real one when
     * somebody supplies a rate.
     */
    for (const stage of fixturePlan().stages) {
      expect(stage.duration.status).toBe('unknown');
      expect(stage.duration.value).toBeNull();
      // And it says *what* is missing, which is the half an engineer can act on: B-7's answer is
      // an installation rate from a referenced standard, so that is what the ref names.
      expect(stage.duration.source.ref).toContain('installation_rate');
      // No arithmetic, because none was possible.
      expect(stage.duration.calculation).toBeNull();
    }
  });

  it('rejects a duration stated without a source', () => {
    // The check the amendment rests on. A figure that reaches a plan with `not_supplied` behind it
    // is exactly the invented duration AD-19 and B-7 were written to prevent.
    const plan = fixturePlan();
    const stages = plan.stages.map((stage) => ({
      ...stage,
      duration: { ...stage.duration, value: 16, status: 'planning' as const },
    }));
    const result = installationPlanSchema.safeParse({ ...plan, stages });
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/EV-/);
  });

  it('accepts a plan that leads with a blocker', () => {
    // Produced, not refused. An engineer reasonably wants the sequence while resolving findings; a
    // plan that quietly sequenced past a RED finding would be a plan to build it.
    const plan = fixturePlan();
    const result = installationPlanSchema.safeParse({
      ...plan,
      blockers: [{ kind: 'open_violation', ref: 'RC-201', stageId: 'equipment_set' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('RetrievalResult', () => {
  it('accepts a result with passages', () => {
    const result = retrievalResultSchema.safeParse({
      query: 'drain height',
      passages: [fixturePassage],
      empty: false,
      searched: ['manufacturer_manual'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an honest empty result', () => {
    const result = retrievalResultSchema.safeParse({
      query: 'drain height',
      passages: [],
      empty: true,
      searched: ['manufacturer_manual'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty flag that disagrees with the passages', () => {
    // `empty` is the field a caller branches on to decide whether to invoke a model at all. If it
    // could disagree with `passages`, retrieval-first would rest on a boolean nobody had checked.
    expect(
      retrievalResultSchema.safeParse({
        query: 'drain height',
        passages: [fixturePassage],
        empty: true,
        searched: [],
      }).success,
    ).toBe(false);

    expect(
      retrievalResultSchema.safeParse({
        query: 'drain height',
        passages: [],
        empty: false,
        searched: [],
      }).success,
    ).toBe(false);
  });

  it('requires a locatable document on every passage', () => {
    // A passage without a citation cannot become one, so the engine discards it rather than passing
    // it on with a caveat.
    const result = retrievalResultSchema.safeParse({
      query: 'drain height',
      passages: [{ ...fixturePassage, source: { ...fixturePassage.source, document: '' } }],
      empty: false,
      searched: ['manufacturer_manual'],
    });
    expect(result.success).toBe(false);
  });
});

describe('AiProposal', () => {
  const validProposal = {
    id: 'proposal_1',
    kind: 'placement' as const,
    source: 'solver' as const,
    confidence: 'deterministic' as const,
    rationale: [{ code: 'AR-102', params: { required: 1200, measured: 1400 }, refersTo: null }],
    commands: [{ type: 'placement.create' as const, payload: { equipmentObjectId: 'vantive_ak98' } }],
    evaluation: {
      before: { RED: 1, YELLOW: 2, GREEN: 0 },
      after: { RED: 0, YELLOW: 2, GREEN: 1 },
      resolves: ['RC-201'],
      introduces: [],
      score: fixtureScoreBreakdown(),
    },
  };

  it('accepts a proposal carrying its score breakdown', () => {
    expect(aiProposalSchema.safeParse(validProposal).success).toBe(true);
  });

  it('rejects a rationale code that is not in the catalogue', () => {
    // An LLM may render a code into prose; it may not invent one. Bad prose is embarrassing, an
    // invented justification is a document that lies about why a machine is where it is.
    expect(
      aiProposalSchema.safeParse({
        ...validProposal,
        rationale: [{ code: 'AR-999', params: {}, refersTo: null }],
      }).success,
    ).toBe(false);
  });

  it('rejects a proposal with no rationale at all', () => {
    expect(aiProposalSchema.safeParse({ ...validProposal, rationale: [] }).success).toBe(false);
  });

  it('requires introduces to be present even when empty', () => {
    // An absent field and an empty one must not look alike. A proposal that lists what it fixes and
    // not what it breaks is the most misleading thing this feature could produce.
    const evaluation = Object.fromEntries(
      Object.entries(validProposal.evaluation).filter(([key]) => key !== 'introduces'),
    );
    expect(aiProposalSchema.safeParse({ ...validProposal, evaluation }).success).toBe(false);
  });

  it('rejects a proposal whose score omits its criteria', () => {
    // B-5a's "never a bare total", reaching a proposal through the nested schema rather than needing
    // its own check here.
    const score = { ...fixtureScoreBreakdown(), criteria: [], total: 0 };
    expect(
      aiProposalSchema.safeParse({
        ...validProposal,
        evaluation: { ...validProposal.evaluation, score },
      }).success,
    ).toBe(false);
  });

  it('speaks only the document model’s own command vocabulary', () => {
    // An accepted proposal must be undoable and must not express anything a hand could not, so the
    // command types are a closed set drawn from CommandType.
    expect(PROPOSED_COMMAND_TYPES).toEqual([
      'placement.create',
      'placement.move',
      'placement.rotate',
      'placement.delete',
    ]);
    expect(
      aiProposalSchema.safeParse({
        ...validProposal,
        commands: [{ type: 'level.deletePlan', payload: {} }],
      }).success,
    ).toBe(false);
  });
});

describe('rationale codes', () => {
  it('carries both languages for every code', () => {
    // The report is bilingual, so a rationale with only English is one it cannot print.
    for (const [code, entry] of Object.entries(RATIONALE_CODES)) {
      expect(entry.title.ko.length, `${code} title.ko`).toBeGreaterThan(0);
      expect(entry.title.en.length, `${code} title.en`).toBeGreaterThan(0);
      expect(entry.template.ko.length, `${code} template.ko`).toBeGreaterThan(0);
      expect(entry.template.en.length, `${code} template.en`).toBeGreaterThan(0);
    }
  });

  it('uses the same placeholders in both languages', () => {
    // The failure this catches is a Korean template that silently drops a number the English one
    // states — the two languages would then describe different things.
    const placeholders = (template: string) =>
      [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

    for (const [code, entry] of Object.entries(RATIONALE_CODES)) {
      expect(placeholders(entry.template.ko), code).toEqual(placeholders(entry.template.en));
    }
  });
});
