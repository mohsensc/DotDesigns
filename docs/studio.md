# The studio

A second, private Vercel project builds this same repo — a plain listing tool
for Hajar to manage her own catalog (title, price, photos/video, cover,
order, sold/in-stock). It's not linked from the public site.

## Setting it up

Create a second Vercel project pointing at this repo, then set:

- `DEPLOY_TARGET=studio` — picks the studio build instead of the public site.
  `scripts/build.mjs` reads this at build time; the outputs land in the same
  `dist/` either way, since `vercel.json` only knows one output directory.
- `PASSWORD=<your value>` — the one thing gating the studio. There's no
  default and no fallback: if it's unset, `api/studio-auth.ts` fails closed
  and refuses to authenticate anyone.

Deploy the project, then note its URL yourself — it isn't written down
anywhere in this repo on purpose. Give that URL and the password to Hajar.

The public project stays as-is: no env var, no change.

## How auth works

One password, compared in constant time server-side. On success the function
sets an HttpOnly cookie holding an HMAC token derived from `PASSWORD`, not
the password itself — the client never sees it and can't forge the cookie
without the server's secret. The studio shows a full-screen lock screen until
that cookie checks out.

## The catalog lives in her browser

Everything Hajar adds — pieces, photos, videos — is saved to that browser's
localStorage and IndexedDB. It does not publish to the live shop. The studio
says this on screen. Getting the work onto the actual site means Export in
the studio, then Import wherever the shop reads its catalog from.
