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
purpose. Give the URL and password to Hajar. The public project is unchanged.

Auth: one password, compared server-side. Success sets an HttpOnly cookie
holding an HMAC token derived from `PASSWORD`, not the password itself.

## Built for her phone

Hajar runs this from her phone. The list is stacked cards, not wide rows —
every action is its own full-width button, Delete sits apart from the rest,
and a save/cancel bar stays pinned to the bottom of the form. Desktop just
centers the same column.

## Size, captions, photos

Size is real numbers (height, length, optional depth) in cm/in/m, with a
live drawing next to a hand or person so she can check it looks right.
Pieces with no fixed size can describe it in words instead. Each photo gets
a caption ("what's in this photo?") — that's what the live site uses for
accessibility, she never sees the word "alt". Photos reorder with move
up/down buttons, no dragging. "Duplicate this piece" copies everything
except photos, so two pieces never share a stored photo.

Uploads get resized (2000px long edge, EXIF rotation respected) and
re-encoded as JPEG before they're stored, since a dozen raw phone photos can
blow the browser's storage quota. The studio shows the saving per file, never
upscales a small image, and a failed save shows a real message. Videos pass
through as-is, with a warning above ~50MB.

## The catalog lives in her browser

Everything Hajar adds — pieces, photos, videos — is saved to that browser's
localStorage and IndexedDB. It does not publish to the live shop. The studio
says this on screen. Getting the work onto the actual site means Export in
the studio, then Import wherever the shop reads its catalog from.
