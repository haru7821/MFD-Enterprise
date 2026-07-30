import { describe, expect, it } from 'vitest';

import {
  fixtureAnswer,
  fixtureCitationScope,
  fixtureExplanation,
  fixturePassage,
} from '../fixtures';
import { validateAnswer, validateExplanation } from './validate';

/**
 * The four checks of AI_SERVICE_API § E.
 *
 * Each test spoils exactly one thing about a payload that otherwise passes, so a failure names the
 * check rather than an accident of construction.
 */

describe('a well-formed response', () => {
  it('is accepted', () => {
    const outcome = validateExplanation(fixtureExplanation(), fixtureCitationScope);
    expect(outcome.ok, JSON.stringify('failures' in outcome ? outcome.failures : [])).toBe(true);
  });
});

describe('check 1 — retrieval preceded reasoning', () => {
  it('rejects a response with no retrieved passages', () => {
    // AD-16, and the whole of the owner's first decision. The prose here is impeccable: bilingual,
    // cited, well-formed. It rests on nothing, so there is no such response.
    const outcome = validateExplanation(
      { ...fixtureExplanation(), retrieved: [] },
      fixtureCitationScope,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failures[0]?.code).toBe('no_retrieval');
  });

  it('distinguishes an empty retrieval from any other malformed payload', () => {
    // These need different words on screen: "not in the indexed corpus" is an honest statement
    // about coverage, while a malformed payload is a fault. One shared code would collapse them.
    const empty = validateExplanation(
      { ...fixtureExplanation(), retrieved: [] },
      fixtureCitationScope,
    );
    const malformed = validateExplanation({ ...fixtureExplanation(), subject: 42 }, fixtureCitationScope);

    expect(empty.ok).toBe(false);
    expect(malformed.ok).toBe(false);
    if (empty.ok || malformed.ok) return;
    expect(empty.failures[0]?.code).toBe('no_retrieval');
    expect(malformed.failures[0]?.code).toBe('schema');
  });
});

describe('check 2 — bilingual completeness', () => {
  it('rejects a response missing Korean', () => {
    const response = fixtureExplanation();
    const outcome = validateExplanation(
      { ...response, text: { ko: '', en: response.text.en } },
      fixtureCitationScope,
    );
    expect(outcome.ok).toBe(false);
  });

  it('rejects a response missing English', () => {
    const response = fixtureExplanation();
    const outcome = validateExplanation(
      { ...response, text: { ko: response.text.ko, en: '' } },
      fixtureCitationScope,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe('check 3 — every number is cited', () => {
  it('rejects a figure that no citation covers', () => {
    // The mechanism behind AD-13. A model cannot get a hallucinated figure onto the screen by
    // writing it into a sentence.
    const response = fixtureExplanation();
    const outcome = validateExplanation(
      {
        ...response,
        text: {
          ko: '요구 정비 공간은 1400 mm입니다.',
          en: 'The required service clearance is 1400 mm.',
        },
        citations: [{ kind: 'passage', ref: 'P1', span: { start: 0, end: 3 } }],
      },
      fixtureCitationScope,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failures.some((f) => f.code === 'uncited_number')).toBe(true);
  });

  it('rejects a figure in a response that cites nothing at all', () => {
    const response = fixtureExplanation();
    const outcome = validateExplanation({ ...response, citations: [] }, fixtureCitationScope);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failures[0]?.code).toBe('uncited_number');
  });

  it('scans both languages, not only English', () => {
    // A check that read only `text.en` would let an invented Korean figure through, and Korean is
    // the language the hospital reads.
    const response = fixtureExplanation();
    const outcome = validateExplanation(
      {
        ...response,
        text: { ko: '요구 정비 공간은 9999 mm입니다.', en: 'No figure in this sentence.' },
        citations: [{ kind: 'rule', ref: 'ak98_front_clearance', span: { start: 0, end: 5 } }],
      },
      fixtureCitationScope,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failures.some((f) => f.detail.startsWith('ko:'))).toBe(true);
  });

  it('accepts prose with no figures and no citations', () => {
    const outcome = validateAnswer(
      { ...fixtureAnswer(), citations: [] },
      fixtureCitationScope,
    );
    expect(outcome.ok).toBe(true);
  });

  it('does not treat a passage label as an uncited number', () => {
    // `[P1]` is the citation apparatus itself. Counting its digit would reject every correctly cited
    // response, which would make the check unusable rather than strict.
    const outcome = validateAnswer(
      {
        ...fixtureAnswer(),
        text: { ko: '색인된 문서를 참조하십시오. [P1]', en: 'See the indexed document. [P1]' },
        citations: [{ kind: 'passage', ref: 'P1', span: null }],
      },
      fixtureCitationScope,
    );
    expect(outcome.ok).toBe(true);
  });
});

describe('check 4 — every citation resolves', () => {
  it('rejects a citation to a rule the request did not supply', () => {
    const response = fixtureAnswer();
    const outcome = validateAnswer(
      { ...response, citations: [{ kind: 'rule', ref: 'invented_rule', span: null }] },
      fixtureCitationScope,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failures[0]?.code).toBe('unresolved_citation');
  });

  it('rejects a citation to a passage this response did not retrieve', () => {
    const response = fixtureAnswer();
    const outcome = validateAnswer(
      { ...response, citations: [{ kind: 'passage', ref: 'P7', span: null }] },
      fixtureCitationScope,
    );
    expect(outcome.ok).toBe(false);
  });

  it('rejects a citation to a real document that was not retrieved', () => {
    // The case retrieval-first exists to remove, and the one a naive check would pass: the document
    // exists, the section number is plausible, and the model did not read it. A citation nobody can
    // follow to the passage it claims is worse than no citation.
    const response = fixtureAnswer();
    const outcome = validateAnswer(
      {
        ...response,
        citations: [{ kind: 'document', ref: 'AK 98 Service Manual', span: null }],
      },
      fixtureCitationScope,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failures[0]?.code).toBe('unresolved_citation');
  });

  it('accepts a document citation naming a document that was retrieved', () => {
    const response = fixtureAnswer();
    const outcome = validateAnswer(
      {
        ...response,
        citations: [{ kind: 'document', ref: fixturePassage.source.document, span: null }],
      },
      fixtureCitationScope,
    );
    expect(outcome.ok).toBe(true);
  });

  it('accepts a finding citation naming a reason code the request supplied', () => {
    const response = fixtureAnswer();
    const outcome = validateAnswer(
      { ...response, citations: [{ kind: 'finding', ref: 'RC-101', span: null }] },
      fixtureCitationScope,
    );
    expect(outcome.ok).toBe(true);
  });

  it('resolves nothing against an empty scope', () => {
    // The default scope is empty rather than permissive. A scope that defaulted to "anything" would
    // make this check pass by construction, which is how a safety check stops being one.
    const outcome = validateAnswer(fixtureAnswer(), {
      ruleIds: [],
      reasonCodes: [],
      catalogueFields: [],
      documents: [],
    });
    // Still passes: the fixture cites a retrieved passage, which resolves without any scope at all.
    expect(outcome.ok).toBe(true);

    const withRule = validateAnswer(
      { ...fixtureAnswer(), citations: [{ kind: 'rule', ref: 'ak98_front_clearance', span: null }] },
      { ruleIds: [], reasonCodes: [], catalogueFields: [], documents: [] },
    );
    expect(withRule.ok).toBe(false);
  });
});

describe('failures are reported together, not one at a time', () => {
  it('reports both an uncited number and an unresolved citation', () => {
    // An engineer debugging a prompt should see everything wrong with one response, not discover
    // the second fault after fixing the first.
    const response = fixtureExplanation();
    const outcome = validateExplanation(
      {
        ...response,
        text: { ko: '값은 1400 mm입니다.', en: 'The value is 1400 mm.' },
        citations: [{ kind: 'rule', ref: 'invented_rule', span: { start: 0, end: 3 } }],
      },
      fixtureCitationScope,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const codes = outcome.failures.map((f) => f.code);
    expect(codes).toContain('uncited_number');
    expect(codes).toContain('unresolved_citation');
  });
});
