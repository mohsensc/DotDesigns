# Dot Designs

Editorial studio website. The home page is the **Cover**, a TypeScript React
component served by a Node/Express backend.

```
DotDesigns/
├── client/            # React + TypeScript (Vite)
│   └── src/
│       ├── pages/Cover.tsx   # main page
│       └── assets/hero.png
├── server/            # Node + Express + TypeScript
│   └── src/index.ts          # serves API + built client
└── package.json       # root scripts (run both together)
```

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
