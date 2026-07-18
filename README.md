# DOT Designs

A **scroll-scrubbed camera flight** through the DOT gallery. The home page (`/`)
is a cinematic "scroll world": as the visitor scrolls, a pre-rendered camera
flies from outside each scene into its interior and flows on to the next with no
cuts — one continuous take through six rooms (storefront → hanging installations
→ figurative relief → the signature Gold Wave → the atelier → materials & finish).

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
engine (copied verbatim from the `scroll-world` skill). It builds its own DOM and
injects its own namespaced CSS into a container. `World.tsx` mounts it from a
`useEffect` via `window.mountScrollWorld(container, CONFIG)` and guards against
React StrictMode's double-mount with a `data-sw-mounted` flag (the engine exposes
no destroy handle). Theme tokens (`--sw-bg`, `--sw-ink`, `--sw-accent`, fonts) are
overridden in `client/src/pages/World.css`; the engine wraps its defaults in
`@layer sw`, so the page's unlayered rules win.

## World assets — the Higgsfield pipeline

The scene posters and camera clips referenced by `World.tsx` live in
`client/public/world/`:

- `client/public/world/<id>.webp` — scene still / poster
- `client/public/world/vid/<id>.mp4` — the scrubbed camera clip

for each section id: `storefront, hanging, figures, goldwave, atelier, materials`.

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
