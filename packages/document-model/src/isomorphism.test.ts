import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The document model runs everywhere, and this is what says so.
 *
 * A document is loaded by the browser editor, by a server that signs a report, and by the test
 * runner. AD-3: the engines are pure and isomorphic. That used to be guaranteed by an absence —
 * the package's tsconfig listed no `DOM` lib and no `node` types, so reaching for either would not
 * compile.
 *
 * Half of that absence is gone. `migration.test.ts` reads a checked-in version 3 project file, and
 * it has to: a fixture built by deleting fields from a *current* document moves with the schema and
 * would keep passing after real v3 files had stopped opening. Reading a file needs `@types/node`,
 * and adding it to the package means `src` could now import `node:fs` and compile.
 *
 * So the guarantee moves from being incidental to being asserted. This is not a worse guarantee
 * than the one it replaces — it is a narrower and more honest one, because it says exactly what is
 * forbidden and where, and it fails with a message naming the file.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

function shippedSources(): string[] {
  return readdirSync(SRC)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
}

describe('the shipped model reaches outside the language for nothing', () => {
  it('has sources to check', () => {
    // Without this the sweep below would pass on an empty list, which is the classic way an
    // architecture test stops testing anything.
    expect(shippedSources().length).toBeGreaterThan(5);
  });

  it.each(shippedSources())('%s imports no Node built-in', (name) => {
    // `node:fs` in the document model would mean a document that only loads where there is a
    // filesystem — and the server that signs a report is not the only place that matters.
    expect(readFileSync(join(SRC, name), 'utf8')).not.toMatch(/from ['"]node:/);
  });

  it.each(shippedSources())('%s touches no DOM global', (name) => {
    /*
     * The other half of AD-3, still enforced by the tsconfig's `lib` — asserted here too so that
     * the rule is written down in one place rather than split between a config and a comment.
     * `document` is deliberately absent from this list: it is this package's own word for a
     * project file and appears on nearly every line.
     */
    const source = readFileSync(join(SRC, name), 'utf8');
    for (const global of ['window.', 'localStorage', 'navigator.', 'HTMLElement']) {
      expect(source, `${name} uses ${global}`).not.toContain(global);
    }
  });
});
