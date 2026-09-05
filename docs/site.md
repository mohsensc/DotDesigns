# How the site is built

The home page (`/`) is a **scroll-scrubbed camera flight** through the DOT
gallery: as the visitor scrolls, a pre-rendered camera flies from outside each
scene into its interior and flows on to the next with no cuts — one continuous
take through five stops (Arrival → The Hall → The Wall → The Studio →
Materials).

React + TypeScript (Vite) client, Node/Express server.

```
DotDesigns/
├── client/            # React + TypeScript (Vite)
│   ├── src/
│   │   ├── pages/World.tsx       # home — the deck, and the loading gate
│   │   ├── pages/Cover.tsx       # the former editorial cover, kept at /cover
│   │   ├── lib/scrub-engine.js   # vanilla-JS scroll-scrub engine
│   │   └── assets/dot-gold.png   # brand logo (used untouched)
│   └── public/world/             # scene stills + clips (see "The film")
├── server/            # Node + Express + TypeScript
│   └── src/index.ts          # serves API + built client
└── package.json       # root scripts (run both together)
```

## Routes

- `/` — **World**, the scroll cinematic (home).
- `/shop` — the catalog grid.
- `/shop/:slug` — one piece.
- `/shop/request` — the Special Request enquiry (composes a mailto, no backend).
- `/cover` — the previous editorial Cover page (kept reachable).
- everything else — 404.

The catalog lives in `client/src/lib/catalog.ts` (types, price bands, demo pieces)
and `client/src/lib/catalog-store.ts` (persistence). The store is a seam: today it
reads localStorage and IndexedDB, so swapping in a real API later is one file.

There's a second build target for the artist's listing tool — see `docs/studio.md`.

## SEO / link previews

Crawlers don't run JS, so `scripts/build.mjs` prerenders real HTML per route
after the Vite build: `dist/index.html`, `dist/shop/index.html`, and
`dist/shop/<slug>/index.html` for every piece, each with its own title, OG/
Twitter tags, canonical link, and Product JSON-LD. It also writes
`sitemap.xml` and `robots.txt`. Public target only — the studio build gets a
disallow-all `robots.txt` instead.

Only pieces committed to `client/src/lib/catalog.demo.json` get a prerendered
page and og:image. Anything Hajar adds through the studio isn't in that file,
so it falls back to the site's default preview until someone adds it to the
demo catalog and regenerates. Site strings (name, description) are kept in
sync by hand between `client/src/lib/seo.ts` and `scripts/build.mjs`.

## Sound

A looping ambient track, off by default, toggled bottom-right. Nothing is fetched
until the visitor asks for it. See `docs/audio.md` for what it is and how it was cut.

## The engine

`client/src/lib/scrub-engine.js` is a framework-agnostic, zero-dependency vanilla
engine. It builds its own DOM and injects its own namespaced CSS into a container.
`World.tsx` mounts it from a `useEffect` via `window.mountScrollWorld(container,
CONFIG)`, guards StrictMode's double-mount with a `data-sw-mounted` flag, and
calls the returned `destroy()` on unmount. Theme tokens (`--sw-bg`, `--sw-ink`,
`--sw-accent`, fonts) live in `client/src/pages/World.css`; the engine wraps its
defaults in `@layer sw`, so the page's unlayered rules win.

### Local extensions

Additions to the original engine. All opt-in; it behaves as originally documented
when they're omitted.

- **`preload` / `preloadGate: n`** — fetch clips at mount, reporting `onProgress`
  / `onReady` so `World.tsx` can hold its loading screen. The gate waits on the
  first n clips; the rest start once `onReady` fired, so they never compete with
  it. A 30s stall timer reveals anyway rather than locking the visitor out.
- **`snap` / `stepScale`** — magnetic stations. Scrolling stays native and one to
  one; when the gesture and its momentum stop the page eases onto the nearest
  station. Keys are the exception — an arrow steps station to station, at
  `stepScale` pace. Touch disarms the magnet for the whole gesture and re-arms on
  lift, so it never pulls against a finger still down.
- **`hold` + per-section `settle`** — a scene's range becomes fly in / park on
  `settle` (the station, where the copy is read) / release the tail. It matters
  because this is one continuous take: each clip's last beat glides toward the
  *next* room, so its final frame is a doorway, not a destination.
- **Per-section `range`** — the slice of a clip a section plays, so one take can be
  split across sections without re-encoding; the blob is fetched once.
- **Per-section `intro`** — a second copy block held on the scene's opening frame,
  so the landing scene can greet before the camera lands.
- **`route: false` / `progress: false`** — both read as scrollbars; drop them.
- **`mobile: {...}` + `rangeMobile`/`settleMobile`/`scrollMobile`** — see below.
- **CTA routing** — a same-origin CTA href emits `scrollworld:navigate` instead of
  following the link; `World.tsx` turns that into a react-router navigate, so the
  shop CTAs don't reload the document and drop the whole film.
- **`destroy()`** — listeners are on the window, the DOM isn't. An SPA must call it
  on unmount or the magnet keeps driving the next route's scroll.

### Two variants, one page

Coarse pointer or <= 860px gets the mobile variant: `clipMobile`, `stillMobile`,
and the `mobile` block shadowing `hold`/`diveScroll`/`crossfade`/`stepScale`/
`lerp`/`magnetDelay`/`magnetScale`/`preloadGate`. Everything derived from those is
live, so **crossing 860px on a desktop resize switches in place**: tear down the
decoders, swap clip + poster + range + settle, relayout, restore the camera to the
same *fraction of the same scene*. Scroll pixels don't survive that — the mobile
variant gives scenes different widths, so the stations move. Debounced 160ms; a
URL-bar height change never crosses the breakpoint, so it never triggers. A
missing mobile poster falls back to the desktop still.

### Measured (Chrome, 4x CPU throttle, scripted scroll, frame intervals)

- **read() write-guarding + scoped `will-change`** (skip unchanged per-frame style
  writes; promote only on-screen scenes). 1440x900: p50 16.1 -> 8.3ms, p95 33-48 ->
  18-25ms, frames over 32ms 23-40 -> 6-14 per 6s pass.
- **Desktop encode: 1080p kept, 1440p (`-hd`) rejected.** With all five legs heavy:
  1080p p50 8.3 / p95 18-25 / 6-14 long frames; 1440p p50 16.3 / p95 25-33 / 12-21.
  One 1440p leg among 1080p neighbours is free — it's the whole-film decoder load
  that breaks the budget, plus ~24MB a clip against ~15MB. (Frame times measured on
  1440p upscales of the masters, before the real `-hd` set existed; right pixel
  count and bitrate, wrong detail. Worth one re-run when all five land.)
- **Mobile encode: 720-wide kept, 1080-wide rejected.** 390x844: medians tie (both
  hit vsync), the tail doesn't — p99 26-33 vs 29-42ms, worst frame 106 vs 445ms —
  and 720 is 46% of the bytes.
- **Mobile gate: reveal after 2 clips.** At 4 Mbit, reveal 18.2s vs 30.8s waiting
  for all four; the film completes at 30.8s either way. 41% off time-to-first-
  scroll. The risk is reaching scene 3 inside that 12.5s window, where the fallback
  is that scene's still — a real frame of the right room, not a blank.
- **Seams unchanged.** Shots 18px either side of all four seams, desktop and
  mobile, magnet stubbed out (it otherwise drags the probe onto a station).
  Against the pre-change build, four of the eight desktop frames are pixel-identical
  and the rest differ by under an LSB (PSNR 104-107dB).
- **Lenis rejected without a branch.** It drives scroll from its own rAF loop — a
  second frame loop — and would fight `tweenTo`'s `scrollTo` and the native-scroll
  magnet. Structural conflict, not a frame-time question.

### Picking a `settle`: mind the keyframes

A paused, scrubbed video paints the keyframe **at or before** the requested time.
The desktop clips carry one every 0.333s, so the picture steps in third-of-a-second
jumps and a `settle` does not necessarily show the frame you asked for. Targeting
6.6s in `gallery.mp4` renders 6.334 — still the plaster monolith, no figure in
shot. Check the preceding keyframe and land inside a step, not on its edge. The
mobile encodes are `-g 4`, so they step finer.

## The film

Posters and clips live in `client/public/world/`: `<id>.webp` + `vid/<id>.mp4`
for desktop, `<id>-m.webp` + `vid/<id>-m.mp4` (native 9:16, 720 wide, `-g 4`) for
the mobile variant. Four clips — `arrival, gallery, atelier, materials` — carry five sections.
`atelier.mp4` is one continuous 9.96s take that tracks the gold wave wall before
passing through a doorway into the studio, so it is read twice over complementary
`range` windows split at 0.56 (the last frame before the doorway appears): **The
Wall** `[0, 0.56]` and **The Studio** `[0.56, 1]`. Their posters are
`atelier.webp` and `studio.jpg`, the latter cut from the split frame so the two
scenes meet on the same image and the seam is invisible.

Clips come from the camera-clip pipeline: a cohesive scene render, then a seamless
camera clip flying from outside into the interior (`crf ~20`, `-g 8`, `+faststart`,
no audio; 1080p desktop, 720-wide `-g 4` mobile). The engine loads each as a Blob
and scrubs `currentTime`, so it doesn't need HTTP byte-range support. Drop new
files in and they're picked up; until they exist the site still runs — a missing
clip falls back to its poster, a missing mobile poster to the desktop still.

`client/public/` is copied into `client/dist/` by Vite, so these assets ship with
the static build served by Vercel.

## What's still broken

- **Mobile frame times were measured on proxies.** The portrait cut landed after
  the numbers above were taken (9:16 centre crops at the same resolution and
  GOP). Right decode cost, wrong framing; re-check seams on a real phone.
- **`materials-m` has a soft dissolve at ~4.75s**, same room, same light. Better
  of two takes.
