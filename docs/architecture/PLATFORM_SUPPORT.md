# Platform Support

> Owner decision, after Sprint 5. **The product is web-native and web-first.**
> This document is the decision, the browser baseline, and — importantly — what is *not*
> verified.

---

## A. The decision

| | |
| --- | --- |
| **Primary** | Desktop browsers |
| **Secondary** | Tablet browsers |
| **Installable** | Progressive Web App |
| **Engines** | Chrome · Microsoft Edge · Safari, from **one codebase** |
| **Forbidden** | Any desktop-only architecture |
| **Later** | Offline capability for recently opened *projects* |

### What this overrides

`CLAUDE.md` listed **Electron** under Architecture → Desktop. That is superseded: there is no
Electron, no native shell, and no desktop-only code path. The line is corrected there rather than
left to be discovered, because a long-term vision document that contradicts a current decision is
how somebody builds the wrong thing in six months.

`OPEN_QUESTIONS` C-3 assumed a web application. It is now a decision, not an assumption.

---

## B. What was already right, and what had to change

The audit, honestly: most of this was already satisfied, and two things were not.

| | State before the decision |
| --- | --- |
| No Electron, no native shell | ✅ Already |
| No `showSaveFilePicker` / File System Access (Chrome and Edge only) | ✅ Already — save is a blob download, open is a file input, both work in Safari |
| **Pointer events**, not mouse events, on the canvas | ✅ Already — which is why touch worked at all |
| `touch-action: none` and `overscroll-behavior: none` on the canvas | ✅ Already |
| No `structuredClone`, `Object.groupBy`, `toSorted`, regex lookbehind, `Intl.Segmenter` | ✅ Already — checked, none present |
| The report engine reads no filesystem | ✅ Already — font bytes are an argument |
| **Pinch-to-zoom** | ❌ **Added.** A tablet has no wheel and no keyboard; the only zoom was the toolbar's ± buttons |
| **PWA manifest, icons, service worker** | ❌ **Added** |
| **iPadOS install metadata** | ❌ **Added** — Safari reads `apple-touch-icon` and the `apple-mobile-web-app-*` meta tags, not the manifest |

The pointer-events choice from Sprint 1 is what made a tablet viable without a rewrite. Worth
recording as a case where the earlier decision paid: mouse-only handlers would have meant touching
every gesture in the editor.

---

## C. Browser baseline

| Engine | Minimum | Why that version |
| --- | --- | --- |
| Chrome / Edge | **111** | Tailwind 4 emits `@property`, `color-mix()` and nested CSS |
| Safari | **16.4** | Same — `@property` and `color-mix()` landed there. Also the first Safari with full `Intl.NumberFormat` v3 behaviour the report relies on |
| Firefox | 128 | Not a target, and expected to work. Not tested. |

**Tailwind 4 sets the floor, not our code.** Worth knowing, because it means the baseline moves
when the CSS framework does — and 16.4 is March 2023, which for a hospital estate's iPads is a real
constraint to check rather than assume.

---

## D. Progressive Web App

### What ships now

| | |
| --- | --- |
| `manifest.webmanifest` | Name, `display: standalone`, theme colour, 192/512 icons and a maskable 512 |
| Icons | Generated PNGs, committed. The maskable one draws inside an 80 % safe zone, because platforms crop it to their own shape |
| `apple-touch-icon.png` + meta tags | iPadOS ignores the manifest for home-screen installs |
| `sw.js` | The app shell, and nothing else |
| File handler | `.mfd.json` declared, so an installed app can be the default opener |

### The service worker's caching policy, and why it is shaped this way

| Request | Policy |
| --- | --- |
| Navigation (the HTML) | **Network first**, cache as an offline fallback |
| `/assets/*` (hashed build output) | **Cache first** |
| Everything else | Network only |
| Project files | Never cached — they are never fetched |

**Network-first navigation is the load-bearing choice.** A stale application in this product is a
hazard, not an inconvenience: an old build carries an old rule set and an old document version, so
it would generate a report that looks current and is not — exactly the class of quiet wrongness the
rest of the codebase is arranged to prevent. So a new deploy is picked up on the next load, and the
worker claims clients immediately rather than asking permission to update.

Cache-first for `/assets/*` is safe **because the filenames are content hashes**: a cached asset
can never be the wrong version of itself, and new HTML references new names.

There is no precache manifest and no build plugin. Nothing is cached until it is used, so the first
visit must be online — which it must be anyway, because that is when the application arrives.

### What "offline" does and does not mean today

| | |
| --- | --- |
| A second visit loads the editor with no network | ✅ |
| An engineer opens their own `.mfd.json` from disk offline | ✅ — it was never a network operation |
| Recently opened projects listed and reopened offline | ❌ **Future sprint**, per the owner |

The distinction is the owner's and it is a good one: caching the *application* is a build concern,
while remembering *projects* means storing hospital floor plans in browser storage — which touches
data residency (B-4) and deserves its own decision.

---

## E. Tablet

Secondary platform: the requirement is that the workflow is reachable, not that the layout is
tuned for a tablet.

| | |
| --- | --- |
| Tested viewport | 1024 × 768 with touch, in CI |
| Place, select, drag, trace | Single-finger, via pointer events |
| Zoom | **Two-finger pinch**, about the midpoint, with the midpoint's movement panning |
| Pan | Two-finger drag, or the pan tool, or a single finger with the pan tool armed |
| No horizontal page scroll | Asserted in CI — a sideways-scrolling editor makes every pan gesture fight the page |
| Browser page zoom | Disabled (`user-scalable=no`). The canvas owns zoom; a browser scaling the page on top of that would leave the drawing at an unknown scale, which for a measuring tool is worse than not zooming |

### One behaviour that is deliberately not automated

**A second finger must not drag the machine the first one landed on.** It is implemented —
`onPointerDown` abandons any drag or vertex grab the moment a second touch arrives, because a
two-finger zoom that also moves equipment is a document change from a gesture meant to change only
the view.

I wrote the spec for it, then disabled the pinch handler to check the spec could fail. **It still
passed.** Raw CDP touch injection does not reproduce the pointer sequence a real two-finger gesture
produces, so the drag never starts and the assertion is satisfied either way. The test was removed
rather than kept: a green test that cannot fail reports coverage that does not exist.

Covered instead by the code path, a comment at the site, and a manual check on a device. Stated
here so the gap is visible rather than implied.

---

## F. What is not verified, and how it is covered instead

The honest section, and the reason this document exists.

| Claim | Verified how |
| --- | --- |
| Works in Chrome | ✅ CI runs Chromium against a production build, 88 specs |
| Works in Edge | ❌ **Not executed.** Same engine as Chrome; covered by using no Chromium-branded API |
| Works in Safari | ❌ **Not executed.** Covered by the baseline in § C, by avoiding engine-specific APIs, and by the audit in § B |
| Installs as a PWA | ⚠️ Partly. The manifest, the icons, their resolution and the worker's policy are asserted in CI; an actual install on a device is not |
| Pinch-to-zoom | ✅ In CI, and **verified by disabling the handler** — the spec failed as it should |
| Tablet layout does not overflow | ✅ In CI at 1024 × 768 |
| Runs with no service worker | ✅ In CI — the whole workflow, including the report |

**Adding Safari and Edge to CI is the obvious next step and it is not free**: WebKit through
Playwright is not Safari, and a real Safari needs macOS runners. Recorded as a known gap rather
than papered over with a WebKit run that would imply more than it proves.

---

## G. Consequences for the rest of the architecture

| | |
| --- | --- |
| Nothing may assume a filesystem | Already true — the report engine takes font bytes as an argument |
| Nothing may assume a Node runtime in `packages/` | Already enforced by the linter |
| No native menus, no OS dialogues, no auto-update | There is no shell to host them |
| The AI service stays HTTP | Sprint 6's `apps/ai-service` is reached by `fetch` from `apps/web`, never by a native bridge |
| Sprint 6's solver runs **in the browser** | `packages/ai-local` is pure TypeScript, which the web-first decision makes a requirement rather than a preference |

That last row is worth noting: the platform decision and the AI architecture agree without either
being adjusted for the other. A deterministic solver that runs client-side is what a web-native
product with an open data-residency question needs, and it is what
[AI_SYSTEM_ARCHITECTURE.md](AI_SYSTEM_ARCHITECTURE.md) already specified.
