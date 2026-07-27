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

- `/` — **World**, the scroll-world cinematic (home).
- `/cover` — the previous editorial Cover page (kept reachable).
- everything else — 404.

## The engine

`client/src/lib/scrub-engine.js` is a framework-agnostic, zero-dependency vanilla
engine (originally from the `scroll-world` skill, since extended — see below). It
builds its own DOM and injects its own namespaced CSS into a container.
`World.tsx` mounts it from a `useEffect` via `window.mountScrollWorld(container,
CONFIG)` and guards against React StrictMode's double-mount with a
`data-sw-mounted` flag (the engine exposes no destroy handle). Theme tokens
(`--sw-bg`, `--sw-ink`, `--sw-accent`, fonts) are overridden in
`client/src/pages/World.css`; the engine wraps its defaults in `@layer sw`, so the
page's unlayered rules win.

### Local extensions

Additions to the original engine. All are opt-in, and it behaves exactly as
originally documented when they are omitted.

- **`preload: true`** — fetch every clip at mount rather than lazily near the
  viewport, and report `onProgress(settled, total)` / `onReady()`. `World.tsx`
  holds a branded loading screen and locks the document until `onReady`, so the
  site is never handed over with the scroll animation still missing. A 30s stall
  timer reveals the page anyway if a clip never lands, rather than locking the
  visitor out; those scenes fall back to their stills.
- **`snap: true`** — magnetic stations. Scrolling stays native and one to one:
  the wheel and the finger drive the camera while the gesture is happening. When
  the gesture and its momentum stop, the page eases onto the nearest station, so
  nobody is left parked mid-flight or mid-dissolve. Keys are the exception — an
  arrow or page key is a discrete request, so it steps station to station.
- **`stepScale`** — multiplier on how long those discrete steps take. 1 is the
  engine default; the site runs 4.
- **`hold: 0..0.8` plus a per-section `settle`** — a scene's scroll range becomes
  three phases: fly in to the `settle` frame, park there while the copy is read
  (this is the station), then release the remaining tail as the visitor scrolls
  away. `settle` matters because this is one continuous take: each clip spends its
  last beat gliding toward the *next* room, so its final frame is a doorway, not a
  destination. Stations are the film's first frame plus each scene's settle —
  later scenes contribute no opening station, since each opens on the frame its
  predecessor closed on.
- **Per-section `range: [start, end]`** — the slice of a clip a section plays, as
  fractions of duration. Lets one continuous take be split across several sections
  without re-encoding; the blob is fetched once and shared between them.
- **Per-section `intro`** — a second copy block shown while the scene is still on
  its opening frame and retired as the flight starts, so the landing scene can
  greet before the section's own copy lands with the camera.
- **`route: false` / `progress: false`** — drop the right-hand route rail and the
  hairline progress bar. Both read as scrollbars; the site runs without either,
  and hides the native scrollbar too (`World.css`), since the stations own the
  scroll position.

### Picking a `settle`: mind the keyframes

A paused, scrubbed video paints the keyframe **at or before** the requested time.
These clips carry one every 0.333s, so the picture steps in third-of-a-second
jumps and a `settle` does not necessarily show the frame you asked for.

This bites. Targeting 6.6s in `gallery.mp4` — where the alabaster figure first
stands clear — renders 6.334 instead, which is still the plaster monolith with no
figure in shot at all. When choosing a settle point, check the preceding keyframe,
not just the frame you want, and land inside a step rather than on its edge.

## The film

Scene posters and camera clips live in `client/public/world/`:

- `client/public/world/<id>.webp` — scene still / poster
- `client/public/world/vid/<id>.mp4` — the scrubbed camera clip

Four clips — `arrival, gallery, atelier, materials` — carry five sections.
`atelier.mp4` is one continuous 9.96s take that tracks the gold wave wall before
passing through a doorway into the studio, so it is read twice over complementary
`range` windows split at 0.56 (the last frame before the doorway appears): **The
Wall** `[0, 0.56]` and **The Studio** `[0.56, 1]`. Their posters are
`atelier.webp` and `studio.jpg`, the latter cut from the split frame so the two
scenes meet on the same image and the seam is invisible.

Clips are produced with the scroll-world skill's **Higgsfield pipeline**: each
scene is generated as a cohesive render, then a seamless camera clip is rendered
flying from outside the scene into its interior (native resolution, `crf ~20`,
`-g 8`, `+faststart`, no audio). The engine loads each clip as a Blob and scrubs
`currentTime` against scroll, so it does not depend on HTTP byte-range support.
Drop new files into the paths above; until they exist the site still runs — the
engine tolerates missing clips, so the poster shows and scenes cross-dissolve.

`client/public/` is copied into `client/dist/` by Vite at build time, so these
assets ship with the static build served by Vercel.
