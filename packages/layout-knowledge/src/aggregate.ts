import { strongestMethod, type DrawingRef, type ObservationMethod, type Support } from './provenance';
import {
  KNOWLEDGE_KINDS,
  KNOWLEDGE_VERSION,
  type Distribution,
  type Frequency,
  type KnowledgeEntry,
  type KnowledgeFile,
  type KnowledgeKind,
  type Observation,
  type RoomFunction,
} from './schema';

/**
 * Observations → derived knowledge.
 *
 * **Pure and deterministic.** No clock, no randomness, no filesystem: the same observations produce
 * byte-identical derived files, which is what lets `knowledge/derived/` be committed *and* checked.
 * `aggregation.test.ts` rebuilds every shipped file and compares — so a derived file edited by hand
 * fails the build rather than quietly outranking the observations it claims to summarise.
 *
 * ## What it does not do
 *
 * It does not interpolate, extrapolate, weight by recency, or fill a gap between two observed values
 * with a plausible third. Every number in the output is either a value that was observed or an
 * order statistic of values that were observed. That constraint is the reason `median` is used
 * rather than `mean`: a median of an even-sized sample is the lower of the two middle readings here,
 * not their average, because an average of 1,800 and 1,900 is 1,850 — a number no drawing showed.
 */

/** Ordered by drawing, then observation id: the sort is the determinism. */
function ordered(observations: readonly Observation[]): Observation[] {
  return [...observations].sort((a, b) => {
    const drawing = a.source.drawing.drawingId.localeCompare(b.source.drawing.drawingId);
    return drawing !== 0 ? drawing : a.id.localeCompare(b.id);
  });
}

/**
 * The lower middle reading, never a computed midpoint.
 *
 * An average of two readings is a number nobody measured, and this package does not produce those.
 * For an odd sample it is the middle value; for an even one it is the lower of the two middle
 * values, chosen rather than averaged.
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted[Math.floor((sorted.length - 1) / 2)];
  if (middle === undefined) throw new Error('median of an empty sample');
  return middle;
}

function distributionOf(values: readonly number[], unit: Distribution['unit']): Distribution {
  return {
    minimum: Math.min(...values),
    median: median(values),
    maximum: Math.max(...values),
    unit,
  };
}

/** Distinct drawings, in a stable order, keyed by id rather than by object identity. */
function drawingsOf(observations: readonly Observation[]): DrawingRef[] {
  const byId = new Map<string, DrawingRef>();
  for (const observation of observations) {
    const { drawing } = observation.source;
    if (!byId.has(drawing.drawingId)) byId.set(drawing.drawingId, drawing);
  }
  return [...byId.values()].sort((a, b) => a.drawingId.localeCompare(b.drawingId));
}

function supportOf(observations: readonly Observation[]): Support {
  const sources = drawingsOf(observations);
  const methods = observations.map((observation) => observation.source.method);
  const strongest: ObservationMethod | null = strongestMethod(methods);
  if (strongest === null) throw new Error('support from no observations');

  return {
    // Distinct drawings, not observations: ten dimensions off one sheet is one hospital's practice
    // recorded ten times, and counting it as ten would turn a template into a consensus.
    drawings: sources.length,
    observations: observations.length,
    strongestMethod: strongest,
    sources,
  };
}

/** Frequencies by distinct drawings, commonest first, ties broken by value for determinism. */
function frequenciesOf(
  observations: readonly Observation[],
  valueOf: (observation: Observation) => string | null,
): Frequency[] {
  const drawingsByValue = new Map<string, Set<string>>();

  for (const observation of observations) {
    const value = valueOf(observation);
    if (value === null) continue;
    const set = drawingsByValue.get(value) ?? new Set<string>();
    set.add(observation.source.drawing.drawingId);
    drawingsByValue.set(value, set);
  }

  return [...drawingsByValue.entries()]
    .map(([value, drawings]) => ({ value, drawings: drawings.size }))
    .sort((a, b) => (b.drawings - a.drawings) || a.value.localeCompare(b.value));
}

/**
 * Group observations by the thing an entry is about.
 *
 * The key decides what a derived entry *is*. A dimension is grouped by its name and the room it was
 * scoped to, so "station pitch in a treatment room" and "station pitch in an isolation room" stay
 * separate rather than merging into one range that describes neither.
 */
interface Group {
  readonly subject: string;
  readonly roomFunction: RoomFunction | null;
  readonly observations: Observation[];
}

function groupBy(
  observations: readonly Observation[],
  keyOf: (observation: Observation) => { subject: string; roomFunction: RoomFunction | null } | null,
): Group[] {
  const groups = new Map<string, Group>();

  for (const observation of ordered(observations)) {
    const key = keyOf(observation);
    if (key === null) continue;

    const id = `${key.subject}::${key.roomFunction ?? ''}`;
    const existing = groups.get(id);
    if (existing) existing.observations.push(observation);
    else groups.set(id, { subject: key.subject, roomFunction: key.roomFunction, observations: [observation] });
  }

  return [...groups.values()].sort(
    (a, b) =>
      a.subject.localeCompare(b.subject) ||
      (a.roomFunction ?? '').localeCompare(b.roomFunction ?? ''),
  );
}

/** Numbers a group contributes to its distribution, skipping the observations that state none. */
function measured(
  group: Group,
  valueOf: (observation: Observation) => number | null,
): number[] {
  return group.observations
    .map(valueOf)
    .filter((value): value is number => value !== null);
}

function entry(
  kind: KnowledgeKind,
  group: Group,
  distribution: Distribution | null,
  frequencies: Frequency[],
): KnowledgeEntry {
  return {
    id: `${kind}:${group.subject}${group.roomFunction ? `:${group.roomFunction}` : ''}`,
    kind,
    subject: group.subject,
    roomFunction: group.roomFunction,
    distribution,
    frequencies,
    support: supportOf(group.observations),
  };
}

/**
 * Build every derived entry of one kind.
 *
 * A `switch` over the nine kinds rather than a table of callbacks, so adding a kind to
 * `KNOWLEDGE_KINDS` without teaching this function what to do with it is a compile error. A kind
 * that aggregated to nothing would produce an empty derived file that looked like "no drawings show
 * this" rather than "nobody wrote the aggregation".
 */
export function entriesFor(
  kind: KnowledgeKind,
  all: readonly Observation[],
): KnowledgeEntry[] {
  const of = all.filter((observation) => observation.value.kind === kind);
  if (of.length === 0) return [];

  switch (kind) {
    case 'common_dimension': {
      return groupBy(of, (observation) =>
        observation.value.kind === 'common_dimension'
          ? { subject: observation.value.name, roomFunction: observation.value.roomFunction }
          : null,
      ).map((group) =>
        entry(
          kind,
          group,
          distributionOf(
            measured(group, (observation) =>
              observation.value.kind === 'common_dimension' ? observation.value.millimetres : null,
            ),
            'mm',
          ),
          [],
        ),
      );
    }

    case 'room_type': {
      return groupBy(of, (observation) =>
        observation.value.kind === 'room_type'
          ? { subject: observation.value.function, roomFunction: observation.value.function }
          : null,
      ).map((group) => {
        const areas = measured(group, (observation) =>
          observation.value.kind === 'room_type' ? observation.value.areaSquareMetres : null,
        );
        return entry(
          kind,
          group,
          // A room type observed only where the drawing printed no area has no distribution, and
          // that is a different statement from an area of zero.
          areas.length > 0 ? distributionOf(areas, 'm2') : null,
          frequenciesOf(group.observations, (observation) =>
            observation.value.kind === 'room_type' && observation.value.stationCount !== null
              ? String(observation.value.stationCount)
              : null,
          ),
        );
      });
    }

    case 'station_layout': {
      return groupBy(of, (observation) =>
        observation.value.kind === 'station_layout'
          ? { subject: observation.value.arrangement, roomFunction: null }
          : null,
      ).map((group) => {
        const pitches = measured(group, (observation) =>
          observation.value.kind === 'station_layout' ? observation.value.pitchMm : null,
        );
        return entry(
          kind,
          group,
          pitches.length > 0 ? distributionOf(pitches, 'mm') : null,
          frequenciesOf(group.observations, (observation) =>
            observation.value.kind === 'station_layout' && observation.value.rowCount !== null
              ? `${observation.value.rowCount} rows`
              : null,
          ),
        );
      });
    }

    case 'equipment_placement': {
      return groupBy(of, (observation) =>
        observation.value.kind === 'equipment_placement'
          ? {
              subject: observation.value.equipmentLabel,
              roomFunction: observation.value.roomFunction,
            }
          : null,
      ).map((group) => {
        const distances = measured(group, (observation) =>
          observation.value.kind === 'equipment_placement'
            ? observation.value.distanceToWallMm
            : null,
        );
        return entry(
          kind,
          group,
          distances.length > 0 ? distributionOf(distances, 'mm') : null,
          frequenciesOf(group.observations, (observation) =>
            observation.value.kind === 'equipment_placement' ? observation.value.relation : null,
          ),
        );
      });
    }

    case 'circulation_path': {
      return groupBy(of, (observation) =>
        observation.value.kind === 'circulation_path'
          ? { subject: observation.value.circulation, roomFunction: null }
          : null,
      ).map((group) => {
        const widths = measured(group, (observation) =>
          observation.value.kind === 'circulation_path' ? observation.value.widthMm : null,
        );
        return entry(
          kind,
          group,
          widths.length > 0 ? distributionOf(widths, 'mm') : null,
          frequenciesOf(group.observations, (observation) =>
            observation.value.kind === 'circulation_path'
              ? `${observation.value.connects[0]} → ${observation.value.connects[1]}`
              : null,
          ),
        );
      });
    }

    case 'ro_room_pattern': {
      return groupBy(of, (observation) =>
        observation.value.kind === 'ro_room_pattern'
          ? { subject: 'ro_room', roomFunction: 'water_treatment' as const }
          : null,
      ).map((group) => {
        const areas = measured(group, (observation) =>
          observation.value.kind === 'ro_room_pattern' ? observation.value.areaSquareMetres : null,
        );
        return entry(
          kind,
          group,
          areas.length > 0 ? distributionOf(areas, 'm2') : null,
          // Adjacency is the reusable part: which rooms an RO room is put next to is a decision a
          // designer makes over and over, and the frequency table is the answer to "what do people
          // normally do" in a form a person can read.
          frequenciesOf(group.observations, (observation) =>
            observation.value.kind === 'ro_room_pattern'
              ? [...observation.value.adjacentTo].sort().join(' + ') || null
              : null,
          ),
        );
      });
    }

    case 'drain_routing':
    case 'electrical_routing': {
      return groupBy(of, (observation) =>
        observation.value.kind === kind
          ? { subject: observation.value.strategy, roomFunction: null }
          : null,
      ).map((group) => {
        const runs = measured(group, (observation) =>
          observation.value.kind === 'drain_routing'
            ? observation.value.diameterMm
            : observation.value.kind === 'electrical_routing'
              ? observation.value.panelToFurthestStationMm
              : null,
        );
        return entry(kind, group, runs.length > 0 ? distributionOf(runs, 'mm') : null, []);
      });
    }

    case 'geometric_pattern': {
      return groupBy(of, (observation) =>
        observation.value.kind === 'geometric_pattern'
          ? { subject: observation.value.name, roomFunction: null }
          : null,
      ).map((group) =>
        entry(
          kind,
          group,
          distributionOf(
            measured(group, (observation) =>
              observation.value.kind === 'geometric_pattern' ? observation.value.occurrences : null,
            ),
            'count',
          ),
          [],
        ),
      );
    }
  }
}

/** Every derived file, one per kind, in the order `KNOWLEDGE_KINDS` declares. */
export function aggregate(
  observations: readonly Observation[],
  generatedFrom: readonly string[],
): KnowledgeFile[] {
  return KNOWLEDGE_KINDS.map((kind) => ({
    kind,
    knowledgeVersion: KNOWLEDGE_VERSION,
    generatedFrom: [...generatedFrom].sort(),
    entries: entriesFor(kind, observations),
  }));
}
