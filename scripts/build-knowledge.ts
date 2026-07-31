import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { aggregate, parseObservationFile, type Observation } from '../packages/layout-knowledge/src/index';

/**
 * Regenerate `knowledge/derived/` from `knowledge/observations/`.
 *
 * The only writer of the derived layer. `boundaries.test.ts` runs the same aggregation and compares
 * against what is committed, so running this and committing the result is the *only* way a figure
 * gets into a derived file — editing one by hand fails the build.
 *
 * Deliberately thin: every decision lives in `aggregate`, which is pure and tested. This reads
 * files, calls it, and writes files.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const KNOWLEDGE = join(REPO, 'knowledge');

const files = readdirSync(join(KNOWLEDGE, 'observations'))
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => ({
    name: `knowledge/observations/${name}`,
    raw: JSON.parse(readFileSync(join(KNOWLEDGE, 'observations', name), 'utf8')) as unknown,
  }));

const observations: Observation[] = files.flatMap(
  (file) => parseObservationFile(file.raw, file.name).observations,
);

mkdirSync(join(KNOWLEDGE, 'derived'), { recursive: true });

for (const file of aggregate(observations, files.map((entry) => entry.name))) {
  const path = join(KNOWLEDGE, 'derived', `${file.kind.replace(/_/g, '-')}.json`);
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

process.stdout.write(
  `knowledge: ${observations.length} observation(s) from ${files.length} file(s) → ` +
    `${readdirSync(join(KNOWLEDGE, 'derived')).length} derived file(s)\n`,
);
