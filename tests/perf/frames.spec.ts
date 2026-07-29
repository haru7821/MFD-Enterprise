import { type Page, test } from '@playwright/test';

/**
 * Frame-time measurement, run on demand rather than in CI.
 *
 *   pnpm test:perf
 *
 * Kept out of `tests/e2e` deliberately: frame times on a shared CI runner are noisy
 * enough that asserting on them produces flaky failures, and a flaky performance gate
 * gets muted rather than fixed. This is an instrument, not a test — it prints numbers
 * that go into docs/testing/PERFORMANCE_TEST_PLAN.md.
 *
 * The load-bearing detail is `sampleDuring`: sampling that finishes before the
 * interaction begins measures an idle tab and always reports a comfortable 60 fps.
 * The first version of this measurement did exactly that.
 */

/** Sample frame intervals WHILE the given interaction runs. */
async function sampleDuring(page: Page, frames: number, interact: () => Promise<void>) {
  const handle = await page.evaluateHandle((n) => {
    const samples: number[] = [];
    let last = performance.now();
    let remaining = n;
    const done = new Promise<number[]>((resolve) => {
      const tick = () => {
        const now = performance.now();
        samples.push(now - last);
        last = now;
        remaining -= 1;
        if (remaining <= 0) resolve(samples);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { done };
  }, frames);

  await interact();
  const samples: number[] = await handle.evaluate((h) => h.done);
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    worst: sorted[sorted.length - 1] ?? 0,
  };
}

async function planFile(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 3000; c.height = 2000;
    const x = c.getContext('2d')!;
    x.fillStyle = '#f0f0f0'; x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = '#444'; x.lineWidth = 3;
    for (let i = 0; i < 40; i += 1) { x.strokeRect(30 + i * 70, 30, 60, 1900); }
    return c.toDataURL('image/png');
  });
  return { name: 'plan.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
}

async function run(page: Page, withPlan: boolean) {
  const box = (await page.locator('div[role="application"]').boundingBox())!;

  const results: Record<string, unknown> = {};

  if (withPlan) {
    const t0 = Date.now();
    await page.getByTestId('plan-file-input').setInputFiles(await planFile(page));
    await page.waitForTimeout(400);
    results['planImportMs'] = Date.now() - t0;

    await page.getByTestId('calibrate').click();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await page.getByTestId('calibration-distance').fill('5000');
    await page.getByTestId('calibration-apply').click();
  }

  // room
  await page.keyboard.press('r');
  for (const [fx, fy] of [[0.08, 0.08], [0.95, 0.08], [0.95, 0.95], [0.08, 0.95]] as const) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  }
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  // place 50
  const place0 = Date.now();
  await page.getByTestId('catalog-item-vantive_ak98').click();
  for (let i = 0; i < 50; i += 1) {
    const fx = 0.12 + (i % 10) * 0.078;
    const fy = 0.15 + Math.floor(i / 10) * 0.15;
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  }
  results['place50Ms'] = Date.now() - place0;
  await page.keyboard.press('Escape');
  results['findings'] = await page.getByTestId('validation-result').count();

  results['idle'] = await sampleDuring(page, 90, async () => { await page.waitForTimeout(1600); });

  results['pan'] = await sampleDuring(page, 90, async () => {
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.keyboard.down('Space');
    await page.mouse.down();
    for (let i = 0; i < 60; i += 1) {
      await page.mouse.move(box.x + box.width * 0.5 + Math.sin(i / 6) * 120, box.y + box.height * 0.5 + Math.cos(i / 6) * 90);
    }
    await page.mouse.up();
    await page.keyboard.up('Space');
  });

  results['drag'] = await sampleDuring(page, 90, async () => {
    await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.15);
    await page.mouse.down();
    for (let i = 0; i < 60; i += 1) {
      await page.mouse.move(box.x + box.width * (0.12 + (i % 20) * 0.004), box.y + box.height * 0.15);
    }
    await page.mouse.up();
  });

  return results;
}

test('sprint 4 baseline', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
  const withPlan = await run(page, true);
  await page.goto('/');
  await page.waitForSelector('canvas');
  const noPlan = await run(page, false);
  console.log('RESULTS ' + JSON.stringify({ withPlan, noPlan }, null, 1));
});
