import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The rule engine runs everywhere, and this is what says so.
 *
 * The same engine gives live feedback in a browser tab and acts as the authority for a signed report
 * on a server (AD-3). That used to be guaranteed by an absence — the package's tsconfig listed no
 * `DOM` lib and no `node` types, so reaching for either would not compile.
 *
 * Half of that absence is gone. `evaluators/independence.test.ts` reads the evaluator sources to
 * assert that containment, collision and clearance cannot see each other's inputs, and reading a
 * file needs `@types/node` — which means `src` could now import `node:fs` and compile.
 *
 * So the guarantee moves from incidental to asserted, exactly as it did in `@mfd/document-model`.
 * That is a narrower and more honest guarantee than the one it replaces, because it says what is
 * forbidden and fails with a message naming the file.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

function shippedSources(): string[] {
  const found: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`);
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) found.push(`${prefix}${name}`);
    }
  };
  walk(SRC, '');
  return found;
}

describe('the shipped engine reaches outside the language for nothing', () => {
  it('has sources to check', () => {
    // Without this the sweeps below pass on an empty list, which is the classic way an architecture
    // test stops testing anything.
    expect(shippedSources().length).toBeGreaterThan(10);
  });

  it.each(shippedSources())('%s imports no Node built-in', (name) => {
    // `node:fs` here would mean a verdict that can only be reached where there is a filesystem, and
    // the browser giving an engineer live feedback is not the odd one out.
    expect(readFileSync(join(SRC, name), 'utf8')).not.toMatch(/from ['"]node:/);
  });

  it.each(shippedSources())('%s touches no DOM global', (name) => {
    /*
     * Named DOM *calls* rather than the bare word `document.`, which this package uses constantly in
     * prose — a rule cites a source document, a finding names the document behind its threshold.
     * `@mfd/document-model` hit the same thing and excluded the word for the same reason. The
     * tsconfig's `lib` is what actually makes a DOM global fail to compile; this is the second lock.
     */
    const source = readFileSync(join(SRC, name), 'utf8');
    for (const global of [
      'window.',
      'document.getElementById',
      'document.querySelector',
      'document.createElement',
      'localStorage',
      'navigator.',
      'HTMLElement',
    ]) {
      expect(source, `${name} uses ${global}`).not.toContain(global);
    }
  });
});
