# The studio

A second, private Vercel project builds this same repo — a plain listing tool
for Hajar to manage her own catalog (title, price, photos/video, cover,
order, sold/in-stock). It's not linked from the public site.

## Setting it up

Create a second Vercel project pointing at this repo, then set:

- `DEPLOY_TARGET=studio` — picks the studio build instead of the public site.
  `scripts/build.mjs` reads this at build time; both land in `dist/`.
- `PASSWORD=<your value>` — the one thing gating the studio. No default, no
  fallback: unset, and `api/studio-auth.ts` fails closed.

Deploy, then note the URL yourself — it isn't written down in this repo on
purpose. Give `<your-studio-domain>` and the password to Hajar. Auth is
one password compared server-side; success sets an HttpOnly cookie holding
an HMAC token derived from `PASSWORD`, not the password itself.

## Built for her phone

Hajar runs this from her phone: stacked cards, full-width buttons, a
save/cancel bar pinned to the bottom of the form. Desktop just centers it.

## Size, captions, photos

Size is real numbers (height, length, optional depth) in cm/in/m, with a
live drawing so she can check it looks right. Each photo gets a caption —
that's the live site's alt text, she never sees the word "alt". Photos
reorder with move up/down buttons, no dragging. Uploads get resized and
re-encoded as JPEG so raw phone photos don't blow the storage quota;
videos pass through as-is, with a warning above ~50MB.

## The catalog lives in her browser — stock lives on the server

Pieces, photos, and videos save to that browser's localStorage/IndexedDB
only; they don't reach the live shop. Export/Import hands that over.

Price and "how many you have" are different: they live in Redis
(`api/_lib/inventory.ts`), behind `api/studio-inventory.ts`, which is what
the live checkout reads. Needs a Redis store connected to the project
(`KV_REST_API_URL`/`KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_*`) — with
neither set, it fails closed.

The Inventory tab is a table over that same data — real table on desktop,
stacked cards on a phone — with price, quantity, and a private notes field
per piece, editable inline, one save per row. Saving from the Pieces tab
also writes price and quantity, so both places agree; that write never
blocks or undoes the local save, it's a bonus on top, with a status line
and a retry on failure.

Two known gaps: renaming a piece orphans its old inventory row, and the
Pieces tab always overwrites price even if Inventory has a newer number.
