# Stripe checkout

`POST /api/checkout` starts a Stripe Checkout session for one piece, priced
and stocked from the Inventory sheet — never from the client. `POST
/api/stripe-webhook` receives the result and decrements stock when a
payment completes.

## Env vars (set by hand on Vercel, not in this repo)

- `STRIPE_KEY` — secret key, used to create Checkout sessions.
- `STRIPE_WEBHOOK_SECRET` — signing secret for the webhook endpoint below.

Both required with no fallback. Missing either fails closed (500, nothing
sent).

## Registering the webhook

In the Stripe dashboard: Developers -> Webhooks -> Add endpoint. Point it at
`<your-deployment>/api/stripe-webhook`, subscribe to `checkout.session.completed`.
Stripe shows the signing secret once, at creation — that's
`STRIPE_WEBHOOK_SECRET`.

## Testing locally

```
stripe listen --forward-to localhost:3000/api/stripe-webhook
stripe trigger checkout.session.completed
```

`stripe listen` prints a `whsec_...` secret for local use — set that as
`STRIPE_WEBHOOK_SECRET` in your local env, separate from the dashboard one.

## Fees

Stripe takes roughly 2.9% + C$0.30 per transaction. Fine for a $200 piece,
not fine on a $12,000 commission — leave the high-value work on the enquiry
form (`/api/inquiry`) rather than routing it through Checkout.

## Branding

The hosted Checkout page's logo and colours are set in the Stripe dashboard
(Settings -> Branding), not in this repo.
