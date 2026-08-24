# Inventory

Price and stock live in Redis on the server, not in this repo and not in the
browser. That's what makes it safe to charge: the client never gets to say what
a piece costs or whether it's still available.

Hajar edits it in the studio's Inventory tab. There's no spreadsheet and no
Google account involved.

## Setup

In the Vercel dashboard, on the **public** project: Storage -> Create Database
-> Redis -> connect it to the project. Vercel adds the credentials itself, so
there's nothing to paste. Redeploy and it's live.

The code reads whichever pair Vercel provisioned:

- `KV_REST_API_URL` + `KV_REST_API_TOKEN`, or
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`

Accepting both is a naming alias, not a fallback value. With neither set,
`isConfigured()` is false, every write fails closed, and the shop degrades to
prices with no buy button.

## Layout

```
inv:slugs        SET of every slug
inv:meta:<slug>  JSON: title, price, notes, updatedAt
inv:qty:<slug>   a bare integer
```

Quantity is its own key on purpose. Folding it into the JSON would force
read-modify-write, which is the race that lets two people buy the last piece at
the same moment. `decrementQuantity` runs a small Lua script instead, so the
sold-out check and the subtraction happen in one atomic step server-side and
stock can never go negative or oversell.

This is the one thing the earlier Google Sheets version could not do.

## Rules worth keeping

A blank price means **not for sale** — the buy button hides and the piece falls
back to the enquiry form. It never means free.

An unparseable price is refused outright rather than coerced. `1200 (was 1500)`
would otherwise strip to `12001500` and charge twelve million dollars for a
twelve hundred dollar piece.

Quantity 0 means sold out on the public site.

## Notes on retries

The Stripe webhook has no event-id dedupe, so a duplicate delivery of the same
paid session decrements twice. The decrement is atomic, so stock can't go
negative — it just undercounts by one. Worth fixing with a `SETNX` on the event
id if sales ever get frequent enough to notice.
