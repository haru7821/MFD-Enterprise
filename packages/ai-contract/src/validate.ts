import { aiAnswerSchema, aiExplanationSchema, aiSummarySchema } from './schema';
import type { Citation, LanguageResponse, RetrievedPassage } from './responses';

/**
 * The four checks that keep an unsourced claim off the screen.
 *
 * From docs/architecture/AI_SERVICE_API.md § E. Three of them compare fields against each other, so
 * they live here rather than in a schema:
 *
 * 1. **Retrieval preceded reasoning.** No passages, no response (AD-16). Enforced in the schema, so
 *    it holds even if nothing calls this.
 * 2. **Bilingual completeness.** Both languages non-empty. Also in the schema.
 * 3. **Every number is cited.** A digit sequence in the text with no citation covering it is
 *    rejected.
 * 4. **Every citation resolves** — to something the request supplied, or to a passage in this
 *    response's own `retrieved` array.
 *
 * ## Why a validator at all, when there is also a prompt
 *
 * A prompt is a **request**; a validator is a **constraint**. That distinction matters more here
 * than anywhere else in this codebase, because the component being asked is the only one that can
 * decline to do what it is told and still appear to have succeeded.
 */

export interface ValidationFailure {
  readonly code: ValidationFailureCode;
  readonly detail: string;
}

export const VALIDATION_FAILURE_CODES = [
  'schema',
  'no_retrieval',
  'uncited_number',
  'unresolved_citation',
] as const;
export type ValidationFailureCode = (typeof VALIDATION_FAILURE_CODES)[number];

export type ValidationOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

/**
 * What the request made available for a citation to name.
 *
 * Assembled by the caller from what it actually sent. **Not optional and not defaulted to
 * "anything":** a permissive default would make check 4 pass by construction, which is the way a
 * safety check quietly stops being one.
 */
export interface CitationScope {
  readonly ruleIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly catalogueFields: readonly string[];
  /** Manual references the request itself supplied, distinct from retrieved passages. */
  readonly documents: readonly string[];
}

export const EMPTY_CITATION_SCOPE: CitationScope = {
  ruleIds: [],
  reasonCodes: [],
  catalogueFields: [],
  documents: [],
};

/**
 * Digit sequences that are not a claim about a measurement.
 *
 * Check 3 is deliberately blunt — any digit run must be covered by a citation — and it has a
 * false-positive cost: a model writing "one of the 4 sides" is rejected for the digit. That cost is
 * worth paying, because the failure it prevents is a number in a document a hospital acts on and the
 * failure it causes is an assistant that occasionally says it could not answer.
 *
 * The one exception is a **passage label**: `[P1]` is the citation apparatus itself, so treating its
 * digit as an uncited number would reject every correctly cited response.
 */
const PASSAGE_LABEL = /\[P\d+\]/g;
const DIGIT_RUN = /\d+(?:[.,]\d+)*/g;

/** A response is only as good as both its languages, so both are scanned. */
export function validateLanguageResponse<T extends LanguageResponse>(
  response: unknown,
  schema: { safeParse(value: unknown): { success: boolean; data?: unknown; error?: unknown } },
  scope: CitationScope,
): ValidationOutcome<T> {
  const parsed = schema.safeParse(response);
  if (!parsed.success) {
    /*
     * Schema failure short-circuits. Running the cross-field checks against a payload of unknown
     * shape would produce a second, misleading complaint about a field that may not exist — and the
     * first failure is already the actionable one.
     */
    return {
      ok: false,
      failures: [{ code: failureCodeFor(parsed.error), detail: describe(parsed.error) }],
    };
  }

  const value = parsed.data as T;
  const failures: ValidationFailure[] = [
    ...uncitedNumbers(value.text.ko, 'ko', value.citations),
    ...uncitedNumbers(value.text.en, 'en', value.citations),
    ...unresolvedCitations(value.citations, value.retrieved, scope),
  ];

  return failures.length === 0 ? { ok: true, value } : { ok: false, failures };
}

export function validateExplanation(response: unknown, scope: CitationScope) {
  return validateLanguageResponse(response, aiExplanationSchema, scope);
}

export function validateAnswer(response: unknown, scope: CitationScope) {
  return validateLanguageResponse(response, aiAnswerSchema, scope);
}

export function validateSummary(response: unknown, scope: CitationScope) {
  return validateLanguageResponse(response, aiSummarySchema, scope);
}

/**
 * Check 3, per language.
 *
 * A number is cited when *some* citation covers its position, or — when the response cites without
 * spans at all — when at least one citation exists. The second case is a deliberate concession:
 * requiring spans everywhere would reject a well-sourced short answer for a formatting detail, and
 * the substantive protection is that a response with **no** citations cannot contain a figure.
 */
function uncitedNumbers(
  text: string,
  language: 'ko' | 'en',
  citations: readonly Citation[],
): ValidationFailure[] {
  const scannable = text.replace(PASSAGE_LABEL, (match) => ' '.repeat(match.length));
  const numbers = [...scannable.matchAll(DIGIT_RUN)];
  if (numbers.length === 0) return [];

  if (citations.length === 0) {
    return [
      {
        code: 'uncited_number',
        detail:
          `${language}: the text states ${numbers.length} numeric value(s) and cites nothing. ` +
          `A figure without a source behind it is not a figure.`,
      },
    ];
  }

  const spans = citations.map((citation) => citation.span).filter((span) => span !== null);
  if (spans.length === 0) return [];

  return numbers.flatMap((match) => {
    const start = match.index;
    const end = start + match[0].length;
    const covered = spans.some((span) => span.start <= start && span.end >= end);
    return covered
      ? []
      : [
          {
            code: 'uncited_number' as const,
            detail: `${language}: "${match[0]}" at ${start}–${end} is not covered by any citation`,
          },
        ];
  });
}

/**
 * Check 4.
 *
 * A `ref` must name something the request supplied, or a passage this response retrieved. **A
 * citation to a document that exists but was not retrieved is still rejected** — that is the whole
 * point of retrieval-first: a model recalling a real section number it did not read produces a
 * citation that looks perfect and cannot be followed to the passage it claims.
 */
function unresolvedCitations(
  citations: readonly Citation[],
  retrieved: readonly RetrievedPassage[],
  scope: CitationScope,
): ValidationFailure[] {
  const passageIds = new Set(retrieved.map((passage) => passage.id));
  const passageDocuments = new Set(retrieved.map((passage) => passage.source.document));

  return citations.flatMap((citation) => {
    if (resolves(citation, scope, passageIds, passageDocuments)) return [];
    return [
      {
        code: 'unresolved_citation' as const,
        detail:
          `${citation.kind} citation "${citation.ref}" names nothing the request supplied or this ` +
          `response retrieved`,
      },
    ];
  });
}

function resolves(
  citation: Citation,
  scope: CitationScope,
  passageIds: ReadonlySet<string>,
  passageDocuments: ReadonlySet<string>,
): boolean {
  switch (citation.kind) {
    case 'rule':
      return scope.ruleIds.includes(citation.ref);
    case 'finding':
      return scope.reasonCodes.includes(citation.ref);
    case 'catalogue_field':
      return scope.catalogueFields.includes(citation.ref);
    case 'passage':
      return passageIds.has(citation.ref);
    case 'document':
      /*
       * A document citation resolves against the *retrieved* passages first, and only then against
       * what the request supplied. Both are legitimate — a finding arrives with its manual
       * reference — but neither is "any document that exists".
       */
      return passageDocuments.has(citation.ref) || scope.documents.includes(citation.ref);
  }
}

/**
 * Distinguish the retrieval failure from any other schema failure.
 *
 * Worth the effort because they call for different words on screen: an empty `retrieved` means "not
 * in the indexed corpus", which is an honest answer about coverage, while a malformed payload means
 * "the assistant could not answer", which is a fault.
 */
function failureCodeFor(error: unknown): ValidationFailureCode {
  const issues = (error as { issues?: readonly { path?: readonly unknown[] }[] } | undefined)
    ?.issues;
  const retrievalIssue = issues?.some((issue) => issue.path?.[0] === 'retrieved');
  return retrievalIssue === true ? 'no_retrieval' : 'schema';
}

function describe(error: unknown): string {
  const issues = (
    error as { issues?: readonly { path?: readonly unknown[]; message?: string }[] } | undefined
  )?.issues;
  if (issues === undefined || issues.length === 0) return 'schema validation failed';
  return issues
    .map((issue) => `${(issue.path ?? []).join('.') || '(root)'}: ${issue.message ?? 'invalid'}`)
    .join('; ');
}
