import { describe, expect, it } from 'vitest';

import { dialysisKnowledge } from '@mfd/layout-knowledge/base';

import { aggregate, entriesFor } from './aggregate';
import { KnowledgeValidationError, parseKnowledgeFile, parseObservationFile } from './load';
import { PATTERN_SUPPORT_THRESHOLD, type Support, isPattern, strongestMethod } from './provenance';
import { createKnowledgeBase } from './query';
import {
  KNOWLEDGE_KINDS,
  KNOWLEDGE_VERSION,
  type Observation,
  type ObservationValue,
} from './schema';

/**
 * The knowledge layer.
 *
 * The assertions are mostly about what it refuses to do: invent a number, average two readings into
 * a third nobody measured, count one drawing twice, or answer a question no drawing addressed.
 * A knowledge base that quietly filled gaps would be worse than none, because its output looks
 * exactly like evidence.
 */

function observation(
  id: string,
  drawingId: string,
  value: ObservationValue,
  method: Observation['source']['method'] = 'dimension_line',
): Observation {
  return {
    id,
    source: {
      drawing: {
        datasetId: 'test',
        drawingId,
        path: `drawings/${drawingId}.pdf`,
        page: 0,
        sheet: null,
        revision: null,
        sha256: null,
      },
      method,
      observer: { type: 'human' as const, name: 'Test Engineer', version: null },
      observationDate: '2026-07-31',
      confidence: 'high' as const,
      note: null,
    },
    value,
  };
}

function pitch(id: string, drawingId: string, millimetres: number): Observation {
  return observation(id, drawingId, {
    kind: 'common_dimension',
    name: 'station_pitch',
    millimetres,
    roomFunction: null,
  });
}

describe('aggregation states only what was observed', () => {
  it('takes a middle reading rather than computing an average', () => {
    /*
     * The line this package will not cross. Two readings of 1,800 and 1,900 average to 1,850 — a
     * number no drawing showed and no hospital built. The median of an even sample is therefore the
     * lower middle *reading*, chosen rather than computed, so every figure in a derived file is one
     * somebody actually measured.
     */
    const base = createKnowledgeBase(
      aggregate([pitch('a', 'd1', 1_800), pitch('b', 'd2', 1_900)], ['test']),
    );

    expect(base.dimension('station_pitch')?.medianMm).toBe(1_800);
    expect(base.dimension('station_pitch')?.minimumMm).toBe(1_800);
    expect(base.dimension('station_pitch')?.maximumMm).toBe(1_900);
  });

  it('keeps the spread, because the spread is often the answer', () => {
    // 1,700–2,100 tells an engineer the pitch is a choice. 1,795–1,805 tells them it is fixed.
    // A median alone cannot distinguish those, and they call for different decisions.
    const base = createKnowledgeBase(
      aggregate(
        [pitch('a', 'd1', 1_700), pitch('b', 'd2', 1_850), pitch('c', 'd3', 2_100)],
        ['test'],
      ),
    );
    const observed = base.dimension('station_pitch');

    expect(observed?.minimumMm).toBe(1_700);
    expect(observed?.medianMm).toBe(1_850);
    expect(observed?.maximumMm).toBe(2_100);
  });

  it('counts distinct drawings, not readings', () => {
    /*
     * Ten dimensions read off one sheet is one hospital's practice recorded ten times. Counting it
     * as ten drawings would let a single template cross the pattern threshold on its own and become
     * "what the industry does".
     */
    const base = createKnowledgeBase(
      aggregate(
        [pitch('a', 'd1', 1_800), pitch('b', 'd1', 1_800), pitch('c', 'd1', 1_800)],
        ['test'],
      ),
    );
    const support = base.dimension('station_pitch')?.support;

    expect(support?.drawings).toBe(1);
    expect(support?.observations).toBe(3);
    expect(isPattern(support!)).toBe(false);
  });

  it('calls something a pattern only once enough drawings agree', () => {
    const below = createKnowledgeBase(
      aggregate([pitch('a', 'd1', 1_800), pitch('b', 'd2', 1_850)], ['test']),
    );
    const at = createKnowledgeBase(
      aggregate(
        [pitch('a', 'd1', 1_800), pitch('b', 'd2', 1_850), pitch('c', 'd3', 1_900)],
        ['test'],
      ),
    );

    expect(PATTERN_SUPPORT_THRESHOLD).toBe(3);
    expect(below.dimension('station_pitch')?.isPattern).toBe(false);
    expect(at.dimension('station_pitch')?.isPattern).toBe(true);
    // Nothing is discarded either way — one hospital's RO room is still worth showing an engineer.
    expect(below.dimension('station_pitch')).not.toBeNull();
  });

  it('names the drawings behind every entry', () => {
    // A figure an engineer cannot trace back to a sheet is a figure they have to take on trust,
    // which is the thing this product refuses to ask of anyone.
    const base = createKnowledgeBase(
      aggregate([pitch('a', 'd2', 1_800), pitch('b', 'd1', 1_900)], ['test']),
    );
    const sources = base.dimension('station_pitch')?.support.sources ?? [];

    expect(sources.map((source) => source.drawingId)).toEqual(['d1', 'd2']);
    expect(sources[0]?.path).toBe('drawings/d1.pdf');
  });

  it('reports the strongest evidence behind a range', () => {
    // A range resting on printed dimensions is a different claim from one resting on measurements
    // taken against a calibrated scale, and a reader deciding whether to act on it needs to know.
    const mixed = createKnowledgeBase(
      aggregate(
        [
          observation('a', 'd1', { kind: 'common_dimension', name: 'aisle_width', millimetres: 1_200, roomFunction: null }, 'calibrated_measurement'),
          observation('b', 'd2', { kind: 'common_dimension', name: 'aisle_width', millimetres: 1_300, roomFunction: null }, 'dimension_line'),
        ],
        ['test'],
      ),
    );

    expect(mixed.dimension('aisle_width')?.support.strongestMethod).toBe('dimension_line');
    expect(strongestMethod([])).toBeNull();
  });

  it('is deterministic — the same observations produce the same bytes', () => {
    // Derived files are committed. If aggregation depended on input order or map iteration, the
    // regeneration check would fail intermittently and everyone would learn to ignore it.
    const shuffled = [pitch('c', 'd3', 1_900), pitch('a', 'd1', 1_800), pitch('b', 'd2', 1_850)];
    const ordered = [pitch('a', 'd1', 1_800), pitch('b', 'd2', 1_850), pitch('c', 'd3', 1_900)];

    expect(JSON.stringify(aggregate(shuffled, ['b', 'a']))).toBe(
      JSON.stringify(aggregate(ordered, ['a', 'b'])),
    );
  });
});

describe('scope is never widened to produce an answer', () => {
  it('does not answer a scoped question with another room’s figure', () => {
    /*
     * A pitch measured in a treatment room says nothing about an isolation room, where the whole
     * point is that patients are further apart. Answering with it would be the knowledge base
     * inventing a reading — precisely what it exists not to do.
     */
    const base = createKnowledgeBase(
      aggregate(
        [
          observation('a', 'd1', { kind: 'common_dimension', name: 'station_pitch', millimetres: 1_800, roomFunction: 'hemodialysis_treatment' }),
        ],
        ['test'],
      ),
    );

    expect(base.dimension('station_pitch', 'hemodialysis_treatment')).not.toBeNull();
    expect(base.dimension('station_pitch', 'isolation_treatment')).toBeNull();
  });

  it('falls back to an unscoped figure, but never the reverse', () => {
    // "Pitch across all rooms" is a genuine weaker answer to "pitch in this room". The reverse is
    // not: a figure from one kind of room is not evidence about rooms in general.
    const unscoped = createKnowledgeBase(aggregate([pitch('a', 'd1', 1_800)], ['test']));
    const scoped = createKnowledgeBase(
      aggregate(
        [
          observation('a', 'd1', { kind: 'common_dimension', name: 'station_pitch', millimetres: 1_800, roomFunction: 'storage' }),
        ],
        ['test'],
      ),
    );

    expect(unscoped.dimension('station_pitch', 'hemodialysis_treatment')?.medianMm).toBe(1_800);
    expect(scoped.dimension('station_pitch', null)).toBeNull();
  });

  it('returns nothing for a measurement no drawing states', () => {
    const base = createKnowledgeBase(aggregate([pitch('a', 'd1', 1_800)], ['test']));

    expect(base.dimension('drain_diameter')).toBeNull();
    expect(base.dimension('delivery_crate_allowance')).toBeNull();
  });

  it('is empty when nothing has been observed, and says so', () => {
    const base = createKnowledgeBase(aggregate([], ['test']));

    expect(base.isEmpty).toBe(true);
    expect(base.dimension('station_pitch')).toBeNull();
    for (const kind of KNOWLEDGE_KINDS) expect(base.ofKind(kind), kind).toEqual([]);
  });
});

describe('every kind aggregates', () => {
  it('produces a file for each of the nine, in the declared order', () => {
    // The owner listed nine. A kind with no aggregation would ship an empty file that read as
    // "no drawings show this" rather than "nobody wrote the code".
    expect(aggregate([], []).map((file) => file.kind)).toEqual([...KNOWLEDGE_KINDS]);
    expect(KNOWLEDGE_KINDS).toHaveLength(9);
  });

  it.each([...KNOWLEDGE_KINDS])('%s turns an observation into an entry', (kind) => {
    /*
     * One observation of each kind, through `entriesFor`. Without this a kind could fall through
     * its branch and return nothing, and the only symptom would be a derived file that stayed empty
     * however many drawings were read.
     */
    const values: Record<string, ObservationValue> = {
      room_type: { kind: 'room_type', function: 'hemodialysis_treatment', label: 'Ward', areaSquareMetres: 84, widthMm: null, depthMm: null, stationCount: 8 },
      equipment_placement: { kind: 'equipment_placement', equipmentLabel: 'AK98', roomFunction: 'hemodialysis_treatment', orientationDegrees: 0, distanceToWallMm: 300, relation: 'against_wall' },
      station_layout: { kind: 'station_layout', arrangement: 'rows', stationCount: 8, pitchMm: 1_800, rowCount: 2, aisleWidthMm: 1_400, roomWidthMm: null, roomDepthMm: null },
      circulation_path: { kind: 'circulation_path', circulation: 'staff', widthMm: 1_500, connects: ['staff_station', 'hemodialysis_treatment'], separatedFromSoiled: true },
      ro_room_pattern: { kind: 'ro_room_pattern', areaSquareMetres: 12, adjacentTo: ['hemodialysis_treatment'], components: ['RO unit'], distanceToTreatmentMm: 6_000, redundancy: 'standby_unit' },
      drain_routing: { kind: 'drain_routing', strategy: 'in_floor', diameterMm: 75, fallPerMetreMm: 10, dischargeTo: 'stack' },
      electrical_routing: { kind: 'electrical_routing', strategy: 'skirting_trunking', socketsPerStation: 2, dedicatedCircuitPerStation: true, panelToFurthestStationMm: 14_000 },
      common_dimension: { kind: 'common_dimension', name: 'station_pitch', millimetres: 1_800, roomFunction: null },
      geometric_pattern: { kind: 'geometric_pattern', name: 'paired stations', description: 'Stations in mirrored pairs about a shared service spine', occurrences: 4 },
    };

    const value = values[kind];
    if (!value) throw new Error(`no fixture observation for ${kind}`);

    const entries = entriesFor(kind, [observation('a', 'd1', value)]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe(kind);
    expect(entries[0]?.support.drawings).toBe(1);
  });
});

describe('the files it will load', () => {
  it('refuses a derived file from a different knowledge version', () => {
    // A derived file from another build carries fields this one drops or lacks ones it needs.
    // Either way the knowledge in memory differs from what was generated, silently.
    expect(() =>
      parseKnowledgeFile(
        { kind: 'room_type', knowledgeVersion: KNOWLEDGE_VERSION + 1, generatedFrom: [], entries: [] },
        'future.json',
      ),
    ).toThrow(KnowledgeValidationError);
  });

  it('refuses an observation with no method, rather than assuming one', () => {
    const raw = observation('a', 'd1', { kind: 'common_dimension', name: 'station_pitch', millimetres: 1_800, roomFunction: null }) as unknown as Record<string, unknown>;
    const source = { ...(raw['source'] as Record<string, unknown>) };
    delete source['method'];

    expect(() =>
      parseObservationFile({ datasetId: 'test', observations: [{ ...raw, source }] }, 'obs.json'),
    ).toThrow(KnowledgeValidationError);
  });

  it('refuses an estimate, because there is no such method', () => {
    /*
     * The enforcement the whole package rests on. If `estimate` were admissible, a base assembled
     * under deadline would fill with numbers eyeballed off uncalibrated PDFs, and nothing
     * downstream could tell those from a printed dimension.
     */
    const raw = observation('a', 'd1', { kind: 'common_dimension', name: 'station_pitch', millimetres: 1_800, roomFunction: null }) as unknown as Record<string, unknown>;
    const source = { ...(raw['source'] as Record<string, unknown>), method: 'estimate' };

    expect(() =>
      parseObservationFile({ datasetId: 'test', observations: [{ ...raw, source }] }, 'obs.json'),
    ).toThrow(KnowledgeValidationError);
  });

  it('names the offending field', () => {
    try {
      parseKnowledgeFile({ kind: 'not_a_kind', knowledgeVersion: 1, generatedFrom: [], entries: [] }, 'bad.json');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as KnowledgeValidationError).fileName).toBe('bad.json');
      expect((error as Error).message).toContain('kind');
    }
  });
});

/**
 * Owner decision D6: *"Support is counted per independent facility, not per file and not per
 * drawing. Multiple PDFs/DWGs of the same facility are corroboration, not independent evidence."*
 *
 * The shipped numbers, pinned. The audit found `station_pitch` claiming 117 — file paths, where the
 * dataset ships most plans as both a `.dwg` and a `.pdf` — against 24 real facilities, and the
 * double counting had moved a figure the solver reads: `corridor_width`'s median shipped as
 * 2,700 mm where collapsing the twins gives 2,040 mm, 32 % out.
 *
 * These assert the corrected values against the built base, so regenerating it with the old rule
 * fails here rather than shipping quietly.
 */
describe('D6 — support counts facilities, and the twins are collapsed', () => {
  function entryFor(name: Parameters<typeof dialysisKnowledge.dimension>[0]) {
    const found = dialysisKnowledge.dimension(name);
    if (!found) throw new Error(`no dimension entry for ${name}`);
    return found;
  }

  it('counts facilities, not files', () => {
    // 117 files, 24 sites. The gap is the whole reason the decision exists.
    expect(entryFor('station_pitch').support.facilities).toBe(24);
    expect(entryFor('station_pitch').support.drawings).toBe(117);
    expect(entryFor('corridor_width').support.facilities).toBe(5);
    expect(entryFor('station_row_spacing').support.facilities).toBe(9);
  });

  it('refuses to call two sites a pattern however many files they ship', () => {
    /*
     * The discriminating case, and it needs constructing: every entry in the shipped base clears the
     * threshold on both counts, so asserting against real data cannot tell the two rules apart.
     * Found by mutation — reverting `isPattern` to `support.drawings` left all 106 tests green.
     *
     * Ten files from two hospitals is exactly the shape owner decision D6 exists to reject: one firm
     * reusing a template, delivered as `.dwg` and `.pdf`, looking like a consensus.
     */
    const twoSites: Support = {
      facilities: 2,
      drawings: 10,
      observations: 10,
      strongestMethod: 'dimension_line',
      sources: [
        {
          datasetId: 'test',
          drawingId: 'Hospital_A/plan.dwg',
          path: 'Hospital_A/plan.dwg',
          page: 0,
          sheet: null,
          revision: null,
          sha256: 'a'.repeat(64),
        },
      ],
    };

    expect(isPattern(twoSites)).toBe(false);
    expect(isPattern({ ...twoSites, facilities: 3 })).toBe(true);
  });

  it('gates isPattern on facilities', () => {
    // Threshold unchanged at 3; what is counted changed. `treatment_room_width` rests on one site
    // and must not be described as observed practice however many files carry it.
    expect(entryFor('station_pitch').isPattern).toBe(true);

    // Read off the entries rather than `dimension()`, which resolves by room function; this one is
    // scoped to `hemodialysis_treatment` and the point here is the support behind it, not the lookup.
    const roomWidth = dialysisKnowledge.entries.find(
      (entry) => entry.kind === 'common_dimension' && entry.subject === 'treatment_room_width',
    );
    expect(roomWidth?.support.facilities).toBe(1);
    expect(isPattern(roomWidth!.support)).toBe(false);
  });

  it('collapses the .dwg/.pdf twins out of the distribution', () => {
    /*
     * The figure that was wrong, and the one the solver reads. Counting each file put one hospital's
     * corridor into the sample twice; 2,040 is the median once a plan counts once per distinct value.
     */
    expect(entryFor('corridor_width').medianMm).toBe(2_040);
  });

  it('ships nine derived kinds that are empty because nothing observes them, not because nothing was found', () => {
    /*
     * **The measured shape of the knowledge base, declared rather than discovered.**
     *
     * `knowledge/derived/` holds ten files. Nine contain `entries: []`, and an empty file reads as
     * *"we looked and found nothing"* when the truth is *"this kind is never collected"* — the same
     * confusion between a checked absence and an unchecked one that this project has been removing
     * everywhere else.
     *
     * Measured: all 183 observations in the corpus are `common_dimension`. There is not one
     * `room_type`, `equipment_placement`, `circulation_path` or `ro_room_pattern` observation, so
     * eight aggregation branches in `aggregate.ts` have never run on real data.
     *
     * Asserted here so the day that changes, this test fails and whoever changed it comes and says
     * so. It is not a complaint about the corpus — it is the corpus's actual reach, written down.
     */
    const kinds = new Set(dialysisKnowledge.entries.map((entry) => entry.kind));

    expect([...kinds]).toEqual(['common_dimension']);
    expect(dialysisKnowledge.entries.length).toBe(4);
  });

  it('omits frequencies entirely rather than emitting an empty one', () => {
    /*
     * > Owner decision: *"Do not emit an empty `frequencies` field. `[]` currently means two
     * > different things: no observations exist, and this observation type never collects
     * > frequencies. Those are different states … Unknown must not masquerade as measured zero."*
     *
     * Both of those states were live at once. `common_dimension` — the only kind with observations
     * — passed a literal `[]` at the call site, and every branch that does compute frequencies
     * belongs to a kind with no observations at all. Every shipped entry therefore carried
     * `frequencies: []`, which reads as a count that came back empty.
     *
     * Asserted as **key absence**, not as `undefined`: the artefact is JSON, and the difference
     * between a missing key and a present-but-empty one is the whole decision.
     */
    for (const entry of dialysisKnowledge.entries) {
      expect(Object.hasOwn(entry, 'frequencies'), `${entry.subject} still emits frequencies`).toBe(
        false,
      );
    }
  });

  it('orders a frequency table by support first, then by value', () => {
    /*
     * The comparator proved against a constructed fixture, because no shipped data reaches it.
     *
     * Stated plainly rather than dressed up: this is **not** proof that the ordering is right for
     * the corpus, because the corpus never produces a frequency table. It is proof that the two
     * keys each decide an ordering, which is what makes them worth keeping until the product
     * question above is answered. If the answer is "remove the field", this test goes with it.
     */
    const roomType = (id: string, drawingId: string, stations: number): Observation =>
      observation(id, drawingId, {
        kind: 'room_type',
        function: 'hemodialysis_treatment',
        label: null,
        areaSquareMetres: null,
        widthMm: null,
        depthMm: null,
        stationCount: stations,
      } as ObservationValue);

    const derived = aggregate(
      [
        /*
         * **The fixture has to make the two keys disagree, and the first one here did not.**
         *
         * A first attempt used 20 on two drawings against 8 and 9 on one each. Deleting the support
         * key still left `'20'` at the head, because `'2'` precedes `'8'` by codepoint too — the
         * fixture agreed with both comparators and so discriminated neither. Measured: the mutation
         * survived.
         *
         * So the most-supported value is now the one that sorts *last* by value: support says 9
         * first, value alone would say 20, 8, 9.
         *
         * The tied pair is inserted `8` before `20` for the same reason. With the *value* key
         * deleted, ties fall back to the insertion order of the underlying `Map` — and a fixture
         * that inserted them in codepoint order would agree with that fallback and let the second
         * mutation survive too. Measured: it did, until these two lines were swapped.
         */
        roomType('a', 'h1/plan', 9),
        roomType('b', 'h2/plan', 9),
        roomType('c', 'h3/plan', 8),
        roomType('d', 'h4/plan', 20),
      ],
      ['test'],
    );

    const roomTypeFile = derived.find((file) => file.kind === 'room_type');
    expect(roomTypeFile?.entries.length, 'the fixture produced no room_type entry').toBe(1);
    const frequencies = roomTypeFile?.entries[0]?.frequencies ?? [];

    // Key 1 decides the head: 9 is the most supported value, and by value alone it would be last.
    expect(frequencies[0]).toEqual({ value: '9', drawings: 2 });

    /*
     * Key 2 decides the tail. `20` and `8` tie at one drawing each, so the *value* orders them — and
     * by codepoint, which is why this asserts `'20'` before `'8'`: these are strings, and a numeric
     * reading would put 8 first. A comparator that sorted them numerically would be a different one
     * than the code ships, and this is where that difference shows.
     */
    expect(frequencies.slice(1)).toEqual([
      { value: '20', drawings: 1 },
      { value: '8', drawings: 1 },
    ]);
  });

  it('keeps two genuinely different readings from one plan', () => {
    /*
     * The trap in the obvious fix. `Hospital_023/dialysis_24bed` records station pitches of 2,000
     * *and* 1,200 — two real runs on one sheet, each appearing once per file format. Collapsing to
     * one reading per plan would have discarded the 1,200, so the key is the plan *and the value*.
     * The surviving spread is the evidence that it was not discarded.
     */
    const pitch = entryFor('station_pitch');
    expect(pitch.minimumMm).toBe(1_200);
    expect(pitch.maximumMm).toBe(2_000);
  });
});
