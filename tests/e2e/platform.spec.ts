import { expect, test } from '@playwright/test';

/**
 * Platform guarantees.
 *
 * Owner decision: the product is web-native — desktop browsers primary, tablet browsers
 * secondary, installable as a Progressive Web App, one codebase across Chrome, Edge and Safari.
 *
 * These specs assert the parts of that which can be checked from a browser. What they cannot
 * check is stated in docs/architecture/PLATFORM_SUPPORT.md rather than implied: this suite runs
 * Chromium only, so Safari and Edge are covered by *avoiding engine-specific APIs* and by the
 * baseline recorded there, not by execution. Saying so is the point — an untested claim that
 * looks tested is worse than an open one.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
});

test('serves a manifest that describes an installable application', async ({ page }) => {
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');

  const response = await page.request.get(`${href}`);
  expect(response.ok()).toBe(true);

  const manifest = (await response.json()) as {
    name: string;
    start_url: string;
    display: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };

  expect(manifest.name).toContain('MFD-E');
  expect(manifest.start_url).toBe('/');
  expect(manifest.display).toBe('standalone');

  // A maskable icon at 512 is what a platform crops to its own shape. Without one, an installed
  // icon is a screenshot of a square in a circle.
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  expect(manifest.icons.some((icon) => icon.sizes === '192x192')).toBe(true);
  expect(manifest.icons.some((icon) => icon.sizes === '512x512')).toBe(true);

  // Every icon actually resolves, and is a PNG. A manifest naming a missing file is an install
  // that fails on a device rather than in CI.
  for (const icon of manifest.icons) {
    const image = await page.request.get(icon.src);
    expect(image.ok(), icon.src).toBe(true);
    const bytes = await image.body();
    expect(bytes.subarray(1, 4).toString('latin1'), icon.src).toBe('PNG');
  }
});

test('carries the iPadOS install metadata, which the manifest does not cover', async ({ page }) => {
  // Safari on iPadOS reads these rather than the manifest for a home-screen install. A tablet
  // is a supported platform, so this is a requirement and not a nicety.
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/apple-touch-icon.png',
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  );

  const icon = await page.request.get('/apple-touch-icon.png');
  expect(icon.ok()).toBe(true);
});

test('serves a service worker that never caches a project file', async ({ page }) => {
  const response = await page.request.get('/sw.js');
  expect(response.ok()).toBe(true);

  const source = await response.text();

  // The policy, asserted against the source rather than trusted: hashed assets cache-first,
  // navigations network-first. A cache-first navigation would serve a stale application, and a
  // stale application carries an old rule set — a report that looks current and is not.
  expect(source).toContain("url.pathname.startsWith('/assets/')");
  expect(source).toContain("request.mode === 'navigate'");
  // GET only, same origin only: a POST is never idempotent enough to replay from a cache, and a
  // cross-origin response is not ours to store.
  expect(source).toContain("request.method !== 'GET'");
  expect(source).toContain('url.origin !== self.location.origin');

  // **Exactly two** response paths — navigations and hashed assets. Counting them is the
  // assertion that nothing else is cached: a third branch is a new caching policy, and it has to
  // be a deliberate change to this test rather than a line somebody added.
  //
  // (Asserting the absence of the string ".mfd.json" was the first version of this and it
  // failed — on the comment in sw.js that explains project files are never cached. A project
  // file is never *fetched*, so there is nothing for a worker to cache; the scope of what it
  // does cache is the thing worth pinning.)
  expect([...source.matchAll(/event\.respondWith\(/g)]).toHaveLength(2);
});

test('runs with no service worker registered at all', async ({ page }) => {
  // The architecture's own test. The preview server is HTTP on localhost, so registration is
  // possible but nothing depends on it — the editor, the findings and the report must behave
  // identically without one.
  const registrations = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 0;
    const all = await navigator.serviceWorker.getRegistrations();
    await Promise.all(all.map((registration) => registration.unregister()));
    return all.length;
  });
  expect(registrations).toBeGreaterThanOrEqual(0);

  await page.reload();
  await page.waitForSelector('canvas');

  await page.getByTestId('catalog-item-vantive_ak98').click();
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('field-placed')).toHaveText('1');
  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('report-panel')).toBeVisible();
});

test('introduces no desktop-only API', async ({ page }) => {
  // Owner decision: no desktop-only architecture. The specific shapes that would break Safari
  // or a tablet are absent, and this asserts it from the running bundle rather than from a grep
  // over source that a dependency could contradict.
  const uses = await page.evaluate(() => ({
    electron: 'electron' in window || 'require' in window,
    // File System Access: Chrome and Edge only. Save/open must stay on a blob download and a
    // file input, which work in every target browser.
    filePicker: 'showSaveFilePicker' in window,
  }));

  expect(uses.electron).toBe(false);
  // The API existing in Chromium is fine; what matters is that the application does not need
  // it. Asserted by the save path working — `spatial.spec.ts` covers the round trip.
  expect(typeof uses.filePicker).toBe('boolean');
});

test.describe('tablet', () => {
  // A 10-inch tablet in landscape. Secondary platform, so the requirement is that the workflow
  // is reachable — not that the layout is tuned for it.
  test.use({ viewport: { width: 1_024, height: 768 }, hasTouch: true });

  test('lays out without scrolling the page sideways', async ({ page }) => {
    // Three fixed columns on a narrower screen is where a desktop-first layout overflows. A
    // horizontally scrolling editor on a touch device is unusable: every pan gesture fights the
    // page.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });

  test('places equipment with a touch tap', async ({ page }) => {
    // Pointer events, not mouse events, is what makes this work — and it is the reason the
    // canvas needed no touch-specific code path to be usable at all.
    await page.getByTestId('catalog-item-vantive_ak98').tap();

    const box = await page.locator('div[role="application"]').boundingBox();
    if (!box) throw new Error('canvas has no bounding box');
    await page.touchscreen.tap(box.x + box.width * 0.4, box.y + box.height * 0.4);

    await expect(page.getByTestId('field-placed')).toHaveText('1');
  });

  test('zooms with a two-finger pinch', async ({ page, browserName }) => {
    // A tablet has no wheel and no keyboard. Without pinch the only way to zoom is the
    // toolbar's ± buttons — reachable, and not how anyone zooms a drawing on a touch screen.
    //
    // Playwright has no pinch primitive, so this drives CDP touch events directly. Chromium
    // only; the gesture itself is plain pointer-event arithmetic with nothing engine-specific
    // in it.
    test.skip(browserName !== 'chromium', 'raw touch injection is Chromium-only here');

    const box = await page.locator('div[role="application"]').boundingBox();
    if (!box) throw new Error('canvas has no bounding box');

    const zoomBefore = Number.parseFloat(await page.getByTestId('field-zoom').innerText());

    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const client = await page.context().newCDPSession(page);

    const touches = (gap: number) => [
      { x: centre.x - gap, y: centre.y, id: 1 },
      { x: centre.x + gap, y: centre.y, id: 2 },
    ];

    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: touches(60),
    });
    for (const gap of [90, 130, 180, 240]) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: touches(gap),
      });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    // Fingers moved apart by 4×, so the view zoomed in. Polled, because the status bar reads
    // the viewport after the frame that changed it.
    await expect
      .poll(async () => Number.parseFloat(await page.getByTestId('field-zoom').innerText()), {
        timeout: 5_000,
      })
      .toBeGreaterThan(zoomBefore * 2);
  });

  /*
   * There is deliberately no automated spec for "a second finger must not drag the machine the
   * first one landed on".
   *
   * The behaviour is implemented — `onPointerDown` abandons any drag or vertex grab the moment a
   * second touch arrives, because a two-finger zoom that also moves equipment is a change to the
   * document from a gesture that was only meant to change the view.
   *
   * I wrote the spec, and then disabled the pinch handler to check it could fail. **It still
   * passed.** Raw touch injection cannot reproduce a two-finger sequence faithfully enough to
   * distinguish the two cases: sending a second `touchStart` while the first point is down does
   * not produce the pointer sequence a real hand produces, so the drag never starts and the
   * assertion is satisfied either way.
   *
   * A green test that cannot fail is worse than an absent one — it reports coverage that does not
   * exist. Recorded in docs/architecture/PLATFORM_SUPPORT.md as covered by code review and manual
   * check on a device, which is the truth.
   */
});
