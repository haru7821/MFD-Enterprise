import { compareCodepoint } from './verification';
import { facilityOf, strongestMethod, type DrawingRef, type ObservationMethod, type Support } from './provenance';
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

/**
 * Ordered by drawing, then observation id — **codepoint order, so the sort really is the
 * determinism it claims to be.**
 *
 * This said *"the sort is the determinism"* while sorting with `localeCompare`, which reads the
 * runtime's locale.
 *
 * **And the corpus discriminates**, so this was not a latent risk — it was live. Switching to
 * codepoint order moved 171 lines of `knowledge/derived/common-dimension.json`: `_reference/30대_
 * sample.pdf` changes position, and so does every `Hospital_NNN/x.pdf` against its `x_2.pdf` twin,
 * because ICU gives `_` a variable weight and codepoint order does not. A Korean filename and an
 * underscore suffix are all it took.
 *
 * Worth recording how that was established, because the first attempt got it backwards: a probe
 * looking for *case-folding collisions* among the 300 drawing ids found none, and this comment
 * briefly claimed the artefact was "byte-stable by luck". The regeneration test then failed. The
 * probe had asked the wrong question — collision, not ordering disagreement — and the claim went in
 * before the evidence, which is the failure this whole sweep is against.
 *
 * `candidates.ts` had already written down why `localeCompare` is wrong. Knowing it in one file did
 * not stop it being used in five others, so the rule is now a test that bans it outright.
 */
function ordered(observations: readonly Observation[]): Observation[] {
  return [...observations].sort(
    (a, b) =>
      compareCodepoint(a.source.drawing.drawingId, b.source.drawing.drawingId) ||
      compareCodepoint(a.id, b.id),
  );
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
  return [...byId.values()].sort((a, b) => compareCodepoint(a.drawingId, b.drawingId));
}

function supportOf(observations: readonly Observation[]): Support {
  const sources = drawingsOf(observations);
  const methods = observations.map((observation) => observation.source.method);
  const strongest: ObservationMethod | null = strongestMethod(methods);
  if (strongest === null) throw new Error('support from no observations');

  return {
    /*
     * Owner decision D6: the number that gates `isPattern` counts **facilities**.
     *
     * The dataset ships most plans as both a `.dwg` and a `.pdf`, and `drawingId` is a file path,
     * so counting drawings counted the same reading twice toward a threshold whose whole purpose is
     * to tell a reused template from a convention.
     */
    facilities: new Set(sources.map((source) => facilityOf(source.drawingId))).size,
    // Distinct drawings, not observations: ten dimensions off one sheet is one hospital's practice
    // recorded ten times, and counting it as ten would turn a template into a consensus. Kept
    // beside `facilities` because it still says how much reading stands behind the entry.
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
    .sort((a, b) => b.drawings - a.drawings || compareCodepoint(a.value, b.value));
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
      compareCodepoint(a.subject, b.subject) ||
      compareCodepoint(a.roomFunction ?? '', b.roomFunction ?? ''),
  );
}

/** Numbers a group contributes to its distribution, skipping the observations that state none. */
/**
 * The readings behind a group, with the **file dimension collapsed**.
 *
 * > Owner decision D6: *"Multiple PDFs/DWGs of the same facility are corroboration, not independent
 * > evidence."*
 *
 * The dataset ships most plans twice, as a `.dwg` and a `.pdf`, and every distribution here was
 * built by counting each file. So one hospital's corridor was in the sample twice and the median
 * moved with it: `corridor_width` shipped **2,700 mm** where collapsing the twins gives **2,040 mm**
 * — 32 % out, on a figure the solver reads.
 *
 * ## Why it is not "one reading per plan"
 *
 * That was the obvious rule and it silently discards real data. `Hospital_023/dialysis_24bed`
 * records station pitches of **2,000 and 1,200** — two genuinely different runs on one sheet — and
 * each appears once per file format, so the plan holds four rows and two facts. Keeping one row per
 * plan would have thrown away the 1,200.
 *
 * So the key is the plan **and the value**: two rows that agree are the same reading seen twice,
 * and two rows that differ are two readings. Measured: `station_pitch` keeps 73 readings under this
 * rule against 71 under one-per-plan, and those two are exactly the sheets above.
 */
function measured(
  group: Group,
  valueOf: (observation: Observation) => number | null,
): number[] {
  const seen = new Set<string>();
  const values: number[] = [];

  for (const observation of group.observations) {
    const value = valueOf(observation);
    if (value === null) continue;

    const key = `${planOf(observation.source.drawing.drawingId)}#${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }

  return values;
}

/**
 * The plan a drawing file belongs to — its id without the format extension.
 *
 * `Hospital_023/dialysis_24bed.dwg` and `…/dialysis_24bed.pdf` are one drawing delivered twice, and
 * this is what makes them one. An id with no extension is its own plan.
 */
function planOf(drawingId: string): string {
  const dot = drawingId.lastIndexOf('.');
  const slash = drawingId.lastIndexOf('/');
  return dot > slash ? drawingId.slice(0, dot) : drawingId;
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
    /*
     * **Omitted rather than emitted empty** — owner decision.
     *
     * `[]` was doing duty for two different states: "no observations exist" and "this kind never
     * collects frequencies". Both appeared in every shipped entry, and an empty array reads as a
     * measurement that found nothing. Spreading the key in only when there is something to say
     * means the artefact is silent where the product is silent.
     */
    ...(frequencies.length > 0 ? { frequencies } : {}),
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
