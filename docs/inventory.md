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
closed and the shop shows prices with no buy button.

## Layout

```
inv:slugs        SET of every slug
inv:meta:<slug>  JSON: title, price, notes, updatedAt
inv:qty:<slug>   a bare integer
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

## What's broken

Renaming a piece moves its row: new slug written, old one deleted, same
request. A crash between the two leaves an orphan row. Harmless.

The Stripe webhook has no event-id dedupe, so a duplicate delivery decrements
twice. Stock can't go negative, it just undercounts by one. A `SETNX` on the
event id fixes it if sales ever get frequent enough to notice.
