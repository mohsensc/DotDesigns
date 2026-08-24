# Stripe checkout

`POST /api/checkout` starts a Stripe Checkout session for one piece, priced
and stocked from the inventory store — never from the client. `POST
/api/stripe-webhook` receives the result and decrements stock when a
payment completes.

## Env vars (set by hand on Vercel, not in this repo)

- `STRIPE_KEY` — the SECRET key (`sk_...`), used to create Checkout sessions.
  Not the publishable key. The publishable key isn't used anywhere here: the
  browser only ever gets redirected to Stripe's hosted page, so no Stripe.js
  runs on our side and there's nothing for a `pk_...` to do.
- `STRIPE_WEBHOOK` — the signing secret (`whsec_...`). This is NOT one
  of the two API keys; it only exists once you create the webhook endpoint
  below.

Both required with no fallback. Missing either fails closed (500, nothing
sent). Test and live mode have separate keys AND separate webhook secrets —
a live `whsec_` will not verify a test-mode event.

## Registering the webhook

In the Stripe dashboard: Developers -> Webhooks -> Add endpoint. Point it at
`https://dotdesigns.art/api/stripe-webhook` and subscribe to BOTH:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

The second one matters. The handler refuses to move stock for a session that
isn't paid yet, so a payment method that settles later would never decrement
if only the first event were registered.

Subscribing to `checkout.session.async_payment_failed` and
`checkout.session.expired` as well is harmless — the handler acknowledges any
event it doesn't recognise with a 200 and does nothing. There is deliberately
nothing to undo on those two: stock is only ever decremented once a payment
has actually succeeded, never optimistically at checkout time, so a failed or
abandoned session leaves stock untouched.

Reveal the endpoint's signing secret afterwards — that's
`STRIPE_WEBHOOK`.

## Testing locally

```
stripe listen --forward-to localhost:3000/api/stripe-webhook
stripe trigger checkout.session.completed
```

`stripe listen` prints a `whsec_...` secret for local use — set that as
`STRIPE_WEBHOOK` in your local env, separate from the dashboard one.

## Fees

Stripe takes roughly 2.9% + C$0.30 per transaction. Fine for a $200 piece,
not fine on a $12,000 commission — leave the high-value work on the enquiry
form (`/api/inquiry`) rather than routing it through Checkout.

## Branding

The hosted Checkout page's logo and colours are set in the Stripe dashboard
(Settings -> Branding), not in this repo.
