/**
 * Register the service worker, or don't.
 *
 * Deliberately quiet and deliberately optional. The application must work identically with no
 * service worker at all — in a browser that does not support one, in a development server, and
 * on the first visit before it has installed. A registration failure is logged and nothing else
 * happens.
 *
 * ## Not in development
 *
 * A service worker in front of a dev server serves yesterday's module and makes an hour
 * disappear. `import.meta.env.PROD` gates it, so `pnpm dev` never has one.
 *
 * ## Why there is no update prompt
 *
 * The usual pattern — "a new version is available, reload?" — needs the engineer to say yes,
 * and until they do they are working in the old build. In this product an old build carries an
 * old rule set, so it can produce a report that looks current and is not.
 *
 * So `sw.js` claims clients immediately and serves navigations network-first: a new deploy
 * arrives on the next load without asking. The trade is that a reload mid-session picks up new
 * code, which for a document-based editor with explicit save is the safer side to be wrong on.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  // After load, so registration never competes with the first paint of the editor.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((cause: unknown) => {
      // Not a user-facing failure: everything works without it. Logged because a silent
      // catch is how "the PWA stopped installing" becomes unexplainable.
      console.warn('MFD-E: the service worker could not be registered.', cause);
    });
  });
}
