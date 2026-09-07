# The studio

A second, private Vercel project builds this same repo — the listing tool Hajar
posts from. Save a piece there and it's on dotdesigns.art. Not linked from the
public site, `robots.txt` disallows everything.

## Where things live

- Catalog (pieces, text, photo captions, order): Redis, key `catalog:v1`, one
  JSON value. Nothing stored yet means the demo pieces in
  `shared/catalog.demo.json`.
- Price and stock: Redis too, `inv:*` — see `docs/inventory.md`. A save writes
  both in one request so they can't disagree.
- Photos and video: Vercel Blob, under `pieces/<pieceId>/`. They go straight
  from her phone to Blob; `api/studio-upload.ts` only signs off on the upload,
  so a 60MB video is never a 60MB request body.

Both projects share one Redis. The public site reads `/api/catalog`; everything
that writes is behind `/api/studio-catalog`, `/api/studio-inventory`,
`/api/studio-upload`.

## Env vars

Studio project: `DEPLOY_TARGET=studio`, `PASSWORD`, `UNLOCK_SECRET`,
`BLOB_READ_WRITE_TOKEN` (Storage -> Blob -> connect the store to the *studio*
project, not just the public one), and the Redis pair Vercel provisions
(`KV_REST_API_URL`/`KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_*`). Env changes
only reach functions on the next deploy, so redeploy after adding one.
Public project: the same Redis pair. No password, no blob token — it only reads.

Unset `PASSWORD` and the studio fails closed. Unset Redis and writes fail;
`/api/catalog` still serves the demo pieces rather than blanking the shop.

## Two rules worth knowing

**409.** Every write sends the `updatedAt` it loaded. If Redis has a newer one
somebody else saved first, so the server answers 409 with the current catalog
instead of flattening their work. The client reloads and re-posts once.

**Sessions end.** The cookie has no Max-Age — closing the browser forgets it —
and the token expires eight hours after login regardless. Old tokens were an
HMAC of a fixed label: one value, valid forever, on every device.

## Lockdown

Five wrong passwords in a row, from anyone, and the studio locks for everyone:
login answers 423, live sessions stop working, the lock screen says "Ask Mohsen
to unlock the website." The shop stays up. Unlock with the "I'm Mohsen" link
on that screen and `UNLOCK_SECRET`, or delete `studio:lockdown` and
`studio:auth:fails` in Redis.

## What's broken

- `/api/catalog` is cached at the edge for 30s, so "immediately" is really
  "within half a minute".
- OG tags are baked at build time from the live catalog. A piece posted after a
  deploy renders fine, it just shares without a preview image until the next
  deploy. Redeploy to fix.
- If a photo upload says it couldn't start and names `BLOB_READ_WRITE_TOKEN`,
  the studio project is missing the token. Set it and redeploy.
- Blob cleanup on delete is best effort. A failed delete leaves the file paid
  for and unreferenced.
