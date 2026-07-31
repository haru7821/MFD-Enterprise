import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { aggregate } from './aggregate';
import { parseDataset, parseKnowledgeFile, parseObservationFile } from './load';
import { KNOWLEDGE_KINDS, type Observation } from './schema';

/**
 * The two structural promises this package makes, asserted rather than documented.
 *
 * 1. **Observed practice never decides compliance.** The rule engine does not import this package,
 *    and cannot, because a verdict resting on what other hospitals happened to do would be a rule
 *    nobody wrote and nothing cited.
 * 2. **Derived files are generated, not written.** Every file in `knowledge/derived/` can be
 *    rebuilt from `knowledge/observations/` byte for byte, so a figure cannot enter the derived
 *    layer without an observation underneath it — including by someone editing the JSON directly.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const KNOWLEDGE = join(REPO, 'knowledge');
const PACKAGES = join(REPO, 'packages');

function sourcesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourcesUnder(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

describe('nothing that decides a verdict may read observed practice', () => {
  /*
   * The packages listed here are the ones whose output an engineer signs. A rule finding, a
   * compliance verdict and a report figure must rest on `standards/` and on the equipment record —
   * documents with a revision behind them — and never on a median across drawings.
   *
   * The solver is deliberately absent from the list: it *is* allowed to consult knowledge, because
   * it proposes rather than judges, and every layout it proposes has already passed the rule
   * engine's hard gates (AD-17).
   */
  it.each(['rule-engine', 'document-model', 'object-library', 'report-engine', 'ai-planner'])(
    '@mfd/%s does not import the knowledge package',
    (name) => {
      const offenders = sourcesUnder(join(PACKAGES, name)).filter((path) =>
        /from '@mfd\/layout-knowledge/.test(readFileSync(path, 'utf8')),
      );

      expect(offenders.map((path) => path.slice(REPO.length + 1))).toEqual([]);
    },
  );

  it('the solver does import it, so this test can tell a rule from a convention', () => {
    // Without this the sweep above would keep passing after the import was removed from everywhere,
    // including from the one package that is supposed to have it — an architecture test that has
    // stopped testing an architecture.
    const solver = sourcesUnder(join(PACKAGES, 'ai-local')).filter((path) =>
      /from '@mfd\/layout-knowledge/.test(readFileSync(path, 'utf8')),
    );

    expect(solver.length).toBeGreaterThan(0);
  });
});

describe('the shipped knowledge base', () => {
  function observationFiles(): { name: string; raw: unknown }[] {
    const directory = join(KNOWLEDGE, 'observations');
    return readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => ({
        name: `knowledge/observations/${name}`,
        raw: JSON.parse(readFileSync(join(directory, name), 'utf8')) as unknown,
      }));
  }

  it('has a derived file for every kind, and no others', () => {
    const files = readdirSync(join(KNOWLEDGE, 'derived')).filter((name) => name.endsWith('.json'));

    expect(files.sort()).toEqual(
      KNOWLEDGE_KINDS.map((kind) => `${kind.replace(/_/g, '-')}.json`).sort(),
    );
  });

  it('parses, dataset and all', () => {
    const dataset = parseDataset(
      JSON.parse(readFileSync(join(KNOWLEDGE, 'dataset.json'), 'utf8')) as unknown,
    );

    expect(dataset.id).toBe('dialysis-drawings');
    // Real hospital drawings are not ours to republish; the dataset says so in a field rather than
    // in a README nobody reads before pushing.
    expect(dataset.redistribution).toBe('derived_knowledge_only');
  });

  it('regenerates byte for byte from its observations', () => {
    /*
     * The promise that makes the derived layer trustworthy. Editing a derived file by hand — to
     * "fix" a median, to add an entry nobody observed — fails here rather than silently outranking
     * the drawings it claims to summarise.
     */
    const files = observationFiles();
    const observations: Observation[] = files.flatMap(
      (file) => parseObservationFile(file.raw, file.name).observations,
    );

    const regenerated = aggregate(observations, files.map((file) => file.name));

    for (const generated of regenerated) {
      const path = join(KNOWLEDGE, 'derived', `${generated.kind.replace(/_/g, '-')}.json`);
      const committed = parseKnowledgeFile(
        JSON.parse(readFileSync(path, 'utf8')) as unknown,
        path,
      );

      expect(committed, generated.kind).toEqual(generated);
    }
  });

  it('holds real observations, every one traceable to a drawing', () => {
    /*
     * This test used to assert the base was **empty**, and said in its own comment that it would
     * fail the moment real observations arrived and should then be replaced. They arrived: 182
     * readings extracted from the hospital dataset's analysis of 117 drawings.
     *
     * What it asserts now is the property that made the empty state defensible in the first place —
     * every figure names the drawings behind it. An entry with no support would be a number that
     * had entered the derived layer from somewhere other than an observation.
     */
    const files = observationFiles();
    expect(files.length).toBeGreaterThan(0);

    const entries = KNOWLEDGE_KINDS.flatMap((kind) => {
      const path = join(KNOWLEDGE, 'derived', `${kind.replace(/_/g, '-')}.json`);
      return parseKnowledgeFile(JSON.parse(readFileSync(path, 'utf8')) as unknown, path).entries;
    });

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.support.drawings, entry.id).toBeGreaterThan(0);
      expect(entry.support.sources.length, entry.id).toBe(entry.support.drawings);
      for (const source of entry.support.sources) {
        // A hash, so the reading is tied to the bytes that were read rather than to a filename.
        expect(source.sha256, entry.id).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  it('records every analyst as a model, not as a person', () => {
    /*
     * > Owner decision: *"The existing analysis blocks were generated by AI. Record them honestly …
     * > Do not represent them as human observations."*
     *
     * The single assertion that keeps that true for every figure in the base. If any of these were
     * re-imported as `human`, nothing else would notice — the numbers would be identical and only
     * the claim about who stands behind them would have changed.
     *
     * Asserted as a **property of every observation**, not as one expected name. There are two
     * producers now — the dataset analyser and the drawing verification harness — and there will be
     * more; a test naming one of them would have to be edited every time, and an edit that says
     * "add the new name here" is exactly how a `human` slips in unnoticed.
     */
    const observations = observationFiles().flatMap(
      (file) => parseObservationFile(file.raw, file.name).observations,
    );

    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) {
      expect(observation.source.observer.type, observation.id).toBe('ai');
      expect(observation.source.observer.name.length, observation.id).toBeGreaterThan(0);
      // The schema requires a version for a non-human observer; asserted here too, because *which*
      // model produced a figure is the part that lets a later reader re-run or discount it.
      expect(observation.source.observer.version, observation.id).not.toBeNull();
    }
  });

  it('the two producers are the ones we expect, and they are both models', () => {
    // Named separately from the property above so a *new* producer appearing in the knowledge base
    // is a visible change to this list rather than something the sweep quietly absorbs.
    const observations = observationFiles().flatMap(
      (file) => parseObservationFile(file.raw, file.name).observations,
    );
    const producers = [
      ...new Set(observations.map((observation) => observation.source.observer.name)),
    ].sort();

    expect(producers).toEqual(['MFD Drawing Verification Harness', 'MFD Hospital Dataset Analyzer']);
  });
});
