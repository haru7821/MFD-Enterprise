import { isPattern, type Support } from './provenance';
import type {
  DimensionName,
  KnowledgeEntry,
  KnowledgeFile,
  KnowledgeKind,
  RoomFunction,
} from './schema';

/**
 * What a consumer may ask the knowledge base, and what it gets back.
 *
 * > Owner decision: *"The optimization engine must consume this knowledge package rather than
 * > embedding layout assumptions."*
 *
 * ## Every answer can be "nothing"
 *
 * {@link KnowledgeBase.dimension} returns `null` when no drawing has been read for that
 * measurement, which is the state the base ships in and will be the state for most measurements for
 * a long time. That is deliberate and it shapes every consumer: a solver that asks for a station
 * pitch has to have an answer for "there is no observed pitch", and the answer must never be a
 * plausible default invented at the call site — which is precisely the embedded assumption this
 * package exists to remove.
 *
 * The pattern to follow is `@mfd/ai-local`'s: a criterion with nothing to measure reports
 * `unavailable`, never zero and never a guess (AD-18).
 *
 * ## Nothing here decides compliance
 *
 * There is no method on this interface that returns a threshold, a limit or a verdict, and that is
 * by construction rather than by convention. Knowledge answers "what did other units do"; only
 * `standards/` answers "what must this one do". A consumer cannot accidentally use an observed
 * median as a requirement, because there is no call that would give them one.
 */

/** An observed measurement, with what it rests on. Never a bare number. */
export interface ObservedDimension {
  readonly name: DimensionName;
  readonly roomFunction: RoomFunction | null;
  readonly minimumMm: number;
  readonly medianMm: number;
  readonly maximumMm: number;
  readonly support: Support;
  /**
   * Whether enough distinct drawings stand behind this to call it practice rather than one site's
   * choice. A consumer seeding a default should require this; a consumer showing an engineer what
   * the dataset contains should not.
   */
  readonly isPattern: boolean;
}

export interface KnowledgeBase {
  /** Every derived entry, for a reader that wants to browse rather than query. */
  readonly entries: readonly KnowledgeEntry[];
  /** True when no drawing has been observed at all — the state this ships in. */
  readonly isEmpty: boolean;
  /** Entries of one kind, in derived order. */
  ofKind(kind: KnowledgeKind): readonly KnowledgeEntry[];
  /**
   * An observed dimension, or null when no drawing states it.
   *
   * `roomFunction` narrows the scope: asking for a station pitch in an isolation room will not
   * silently answer with the treatment-room figure. When a scoped entry does not exist the
   * unscoped one is returned if there is one, because "station pitch across all rooms" is a
   * genuine weaker answer — but never the other way round, since a figure measured in one kind of
   * room is not evidence about a different kind.
   */
  dimension(name: DimensionName, roomFunction?: RoomFunction | null): ObservedDimension | null;
}

/** Build a query interface over derived files. Pure — the caller does the reading. */
export function createKnowledgeBase(files: readonly KnowledgeFile[]): KnowledgeBase {
  const entries = files.flatMap((file) => file.entries);
  const byKind = new Map<KnowledgeKind, KnowledgeEntry[]>();
  for (const entry of entries) {
    byKind.set(entry.kind, [...(byKind.get(entry.kind) ?? []), entry]);
  }

  const dimensions = entries.filter((entry) => entry.kind === 'common_dimension');

  function find(name: string, roomFunction: RoomFunction | null): KnowledgeEntry | null {
    return (
      dimensions.find(
        (entry) => entry.subject === name && entry.roomFunction === roomFunction,
      ) ?? null
    );
  }

  return {
    entries,
    isEmpty: entries.length === 0,

    ofKind: (kind) => byKind.get(kind) ?? [],

    dimension(name, roomFunction = null) {
      /*
       * Scoped first, then unscoped. Never the reverse and never a different room: a pitch measured
       * in a treatment room says nothing about an isolation room, and answering with it would be
       * the knowledge base inventing a reading — the one thing it must not do.
       */
      const entry = find(name, roomFunction) ?? (roomFunction === null ? null : find(name, null));
      if (!entry?.distribution) return null;

      return {
        name,
        roomFunction: entry.roomFunction,
        minimumMm: entry.distribution.minimum,
        medianMm: entry.distribution.median,
        maximumMm: entry.distribution.maximum,
        support: entry.support,
        isPattern: isPattern(entry.support),
      };
    },
  };
}
