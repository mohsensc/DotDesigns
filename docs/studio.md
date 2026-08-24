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
purpose. Give `<your-studio-domain>` and the password to Hajar.

Auth: one password, compared server-side. Success sets an HttpOnly cookie
holding an HMAC token derived from `PASSWORD`, not the password itself.

## Built for her phone

Hajar runs this from her phone: stacked cards, full-width buttons, a save/cancel
bar pinned to the bottom of the form. Desktop just centers it.

## Size, captions, photos

Size is real numbers (height, length, optional depth) in cm/in/m, with a
live drawing so she can check it looks right. Each photo gets a caption —
that's the live site's alt text, she never sees the word "alt". Photos
reorder with move up/down buttons, no dragging. Uploads get resized and
re-encoded as JPEG so raw phone photos don't blow the storage quota;
videos pass through as-is, with a warning above ~50MB.

## The catalog lives in her browser — stock lives in a sheet

Pieces, photos, and videos save to that browser's localStorage/IndexedDB
only; they don't reach the live shop. Export/Import hands that over.

Price and "how many you have" are different: on save, the studio also
posts them to `api/studio-sheet.ts`, which writes into the `Inventory` tab
of a Google Sheet (`api/_lib/inventory.ts`) — the same sheet the live
checkout reads for price and stock. Needs `GOOGLE_SERVICE_ACCOUNT_EMAIL`,
`GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEETS_ID`, same as the rest of inventory.

That sync never blocks or undoes the local save, it's a bonus on top. A
status line says whether it went through, with a retry on failure, and an
"Open your inventory sheet" link once known. That link contains the
spreadsheet id, so the id does reach the browser — but only behind the
password gate, and the sheet is protected by Google's own sharing anyway.
The service account key never leaves the server.

Two known gaps: renaming a piece orphans its old sheet row (slug changes);
and if the sheet's unreachable when opening a piece, saving overwrites its
count and notes with whatever's on screen — the form warns when that's true.
