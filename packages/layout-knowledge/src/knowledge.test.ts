import { describe, expect, it } from 'vitest';

import { aggregate, entriesFor } from './aggregate';
import { KnowledgeValidationError, parseKnowledgeFile, parseObservationFile } from './load';
import { PATTERN_SUPPORT_THRESHOLD, isPattern, strongestMethod } from './provenance';
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
        sheet: null,
        revision: null,
        sha256: null,
      },
      method,
      observedBy: 'Test Engineer',
      observedAt: '2026-07-31',
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
