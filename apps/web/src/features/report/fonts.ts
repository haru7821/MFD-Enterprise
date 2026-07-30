import type { FontBytes } from '@mfd/report-engine';

/**
 * Load the report fonts, in the browser.
 *
 * The report engine takes font **bytes** rather than reading a file, which is what keeps it
 * runnable in a browser and on a server. Getting the bytes is therefore the host's job, and
 * this is the browser's half of it.
 *
 * ## Why a dynamic import
 *
 * The two faces are 5.4 MB. Most sessions never generate a report, and a user who is placing
 * equipment should not pay for a Korean font on first paint. `import()` puts them in their own
 * chunk, fetched the first time somebody clicks Report — the same treatment the pdf.js worker
 * already gets.
 *
 * `?url` asks Vite for the asset's URL rather than its contents, so the font is a file the
 * browser caches rather than several megabytes of base64 inside a JavaScript module.
 *
 * Loaded once and memoised: a second report reuses the bytes.
 */

let cached: Promise<FontBytes> | null = null;

async function fetchFont(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    // Named loudly. A report that silently fell back to a Latin-only font would draw blank
    // boxes where Korean should be, which is exactly what the engine refuses to do.
    throw new Error(`could not load the report font from ${url} (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function loadReportFonts(): Promise<FontBytes> {
  cached ??= (async () => {
    const [{ default: regular }, { default: bold }] = await Promise.all([
      import('@mfd/report-engine/assets/fonts/Pretendard-Regular.ttf?url'),
      import('@mfd/report-engine/assets/fonts/Pretendard-Bold.ttf?url'),
    ]);

    const [regularBytes, boldBytes] = await Promise.all([
      fetchFont(regular),
      fetchFont(bold),
    ]);

    return { regular: regularBytes, bold: boldBytes };
  })();

  return cached;
}
