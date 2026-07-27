# DOT Designs

A **scroll-scrubbed camera flight** through the DOT gallery. The home page (`/`)
is a cinematic "scroll world": as the visitor scrolls, a pre-rendered camera
flies from outside each scene into its interior and flows on to the next with no
cuts — one continuous take through five stops (Arrival → The Hall → The Wall →
The Studio → Materials).

Built as a React + TypeScript (Vite) client with a Node/Express server.

```
DotDesigns/
├── client/            # React + TypeScript (Vite)
│   ├── src/
│   │   ├── pages/World.tsx       # home — mounts the scroll-world engine
│   │   ├── pages/Cover.tsx       # the former editorial cover, kept at /cover
│   │   ├── lib/scrub-engine.js   # vanilla-JS scroll-scrub engine (verbatim)
│   │   └── assets/dot-gold.png   # brand logo (used untouched)
│   └── public/world/             # scene stills + clips (see "World assets")
├── server/            # Node + Express + TypeScript
│   └── src/index.ts          # serves API + built client
└── package.json       # root scripts (run both together)
```

## Routes

- `/` — **World**, the scroll-world cinematic (home).
- `/cover` — the previous editorial Cover page (kept reachable).
- everything else — 404.

## The scroll-world engine

`client/src/lib/scrub-engine.js` is a framework-agnostic, zero-dependency vanilla
engine (originally copied from the `scroll-world` skill, since extended — see
below). It builds its own DOM and injects its own namespaced CSS into a container.
`World.tsx` mounts it from a `useEffect` via `window.mountScrollWorld(container,
CONFIG)` and guards against React StrictMode's double-mount with a
`data-sw-mounted` flag (the engine exposes no destroy handle). Theme tokens
(`--sw-bg`, `--sw-ink`, `--sw-accent`, fonts) are overridden in
`client/src/pages/World.css`; the engine wraps its defaults in `@layer sw`, so the
page's unlayered rules win.

### Local extensions to the engine

These options are additions to the skill's original engine. All are opt-in and the
engine behaves exactly as documented when they are omitted.

- **`preload: true`** — fetch every clip at mount rather than lazily near the
  viewport, and report `onProgress(settled, total)` / `onReady()`. `World.tsx`
  holds a branded loading screen and locks the document until `onReady`, so the
  site is never handed over with the scroll animation still missing. A 30s stall
  timer reveals the page anyway if a clip never lands, rather than locking the
  visitor out; those scenes fall back to their stills.
- **`snap: true`** — station-to-station navigation. Native scrolling is suppressed
  (wheel, touch, keys) and every move is an eased tween between *stations*, so a
  flight or a seam dissolve always completes instead of being dragged through by
  hand. One flick is one station. Anything that moves the page another way (a
  scrollbar drag, a restored offset) eases onto the nearest station once it stops.
- **`hold: 0..0.8` plus a per-section `settle`** — a dive's scroll range becomes
  three phases: fly in to the `settle` frame, park there while the copy is read
  (this is the arrival station), then release the remaining tail as the visitor
  scrolls away. `settle` matters because this is one continuous take: each clip
  spends its last beat gliding toward the *next* room, so its final frame is a
  doorway, not a destination. Stations are the film's first frame plus each
  scene's arrival — later scenes contribute no opening station, since each opens
  on the frame its predecessor closed on.
- **Per-section `range: [start, end]`** — the slice of a clip a section plays, as
  fractions of duration. Lets one continuous take be split across several sections
  without re-encoding; the blob is fetched once and shared between them.
- **Per-section `intro`** — a second copy block shown while the scene is still on
  its opening frame and retired as the flight starts, so the landing scene can
  greet before the section's own copy lands with the camera.

## World assets — the Higgsfield pipeline

The scene posters and camera clips referenced by `World.tsx` live in
`client/public/world/`:

- `client/public/world/<id>.webp` — scene still / poster
- `client/public/world/vid/<id>.mp4` — the scrubbed camera clip

The film currently ships four clips — `arrival, gallery, atelier, materials` —
carrying five sections. `atelier.mp4` is one continuous 9.96s take that tracks the
gold wave wall before passing through a doorway into the studio, so it is read
twice over complementary `range` windows split at 0.56 (the last frame before the
doorway appears): **The Wall** `[0, 0.56]` and **The Studio** `[0.56, 1]`. The
posters are `atelier.webp` and `studio.jpg`, the latter cut from the split frame
so the two scenes meet on the same image and the seam is invisible.

These are produced with the **scroll-world skill's Higgsfield pipeline**: each
scene is generated as a cohesive render, then a seamless camera clip is rendered
flying from outside the scene into its interior (native resolution, `crf ~20`,
`-g 8`, `+faststart`, no audio). The engine loads each clip as a Blob and scrubs
`currentTime` against scroll, so it does not depend on HTTP byte-range support.
Drop the produced files into the paths above; until they exist the site still
runs — the engine tolerates missing clips, so the still poster shows and scenes
simply cross-dissolve.

`client/public/` is copied into `client/dist/` by Vite at build time, so these
assets ship with the static build served by Vercel.

## Install

```bash
npm run install:all
```

## Develop

Runs the Vite dev server (client) and the Express API together:

```bash
npm run dev
```

- Client (hot reload): http://localhost:5173
- API: http://localhost:3001/api/health (proxied from the client at `/api`)

## Production

Builds the client and compiles the server, then serves everything from Express:

```bash
npm run build
npm start
# → http://localhost:3001
```
