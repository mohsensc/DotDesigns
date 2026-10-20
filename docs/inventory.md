# Inventory

Price and stock live in Redis, not in this repo and not in a browser. That's
what makes it safe to charge: the client never gets to say what a piece costs
or whether it's still available. Hajar edits it in the studio's Inventory tab,
and saving a piece writes its price and quantity too — one tap, both places.

## Setup

Vercel dashboard, **public** project: Storage -> Create Database -> Redis ->
connect. Vercel adds the credentials itself. Connect the same store to the
studio project: one ledger, two front doors.

The code reads whichever pair Vercel provisioned:

- `KV_REST_API_URL` + `KV_REST_API_TOKEN`, or
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`

Accepting both is a naming alias, not a fallback. With neither set, writes fail
closed, `/api/inventory` and `/api/checkout` answer 503, and the shop shows
"Checkout unavailable" with the catalog price. Connect the store to the public
project and check that `/api/inventory` answers 200 with rows before merging
anything that depends on it.

## Layout

```
inv:slugs        SET of every slug
inv:meta:<slug>  JSON: title, price, notes, updatedAt
inv:qty:<slug>   a bare integer
inv:holds:<slug> ZSET of checkouts in progress, scored by when they run out
inv:paid:<id>    one per paid Stripe session, kept a week, stops double counting
catalog:v1       the catalog itself (see docs/studio.md)
```

Quantity is its own key on purpose. Folding it into the JSON would force
read-modify-write, the race that lets two people buy the last piece at once.
`decrementQuantity` runs a small Lua script instead, so the sold-out check and
the subtraction happen in one atomic step. Sheets could not do that.

## Rules worth keeping

A blank price means **not for sale** — the buy button hides and the piece falls
back to the enquiry form. It never means free. An unparseable price is refused outright rather than coerced. `1200 (was 1500)`
would otherwise strip to `12001500` and charge twelve million dollars for a
twelve hundred dollar piece. Quantity 0 means sold out.

## Saving from the studio

A save sends the count it loaded (`expectedQuantity`) along with the new one.
Unchanged counts are never written, so fixing a caption can't undo a sale that
landed while the form was open. A changed count is written only if the stored
one still matches what was loaded, otherwise the request answers 409 and leaves
the count alone. A price set in the Stock tab is copied into the catalog too, so
the next Composer save keeps it. Prices under 0.50 are refused; blank means not
for sale.

## Holds

Checkout takes a hold on one unit before it asks Stripe for a session, so the
last piece can't be sold to two people at once. Available stock is the count
minus live holds. A hold is released when the session expires, when Stripe
creation fails, or on its own after 33 minutes. A hold with the same `holdId`
(one per page load) doesn't count against itself, so a retry works. Checkout
also refuses pieces whose catalog status isn't `available`.

## What's broken

Renaming a piece moves its row: new slug written, old one deleted, same
request. A crash between the two leaves an orphan row. Harmless.

The public `/api/inventory` shows the stored count, not the count minus live
holds, and it is cached at the edge for 30 seconds. A piece that someone is
paying for can look available for a moment; checkout is what answers for it.
