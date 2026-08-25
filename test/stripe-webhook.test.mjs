// Tests for the Stripe webhook — the only endpoint that can mark stock sold
// on its own, off the back of a POST nobody asked to trust. The signature
// check is the entire security model, so every test here proves something
// about what happens to *stock*, not just what status code comes back: a
// check that only inspects res.statusCode would still pass if the guard
// were deleted and the handler decremented on every POST.
//
//   node --test test/stripe-webhook.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { bundle, startFakeRedis, makeStreamReq, makeRes, stripeSignature } from "./helpers.mjs";

const redis = await startFakeRedis();
process.env.KV_REST_API_URL = redis.url;
process.env.KV_REST_API_TOKEN = redis.token;

const inv = await import(bundle("api/_lib/inventory.ts"));
const { default: handler } = await import(bundle("api/stripe-webhook.ts"));

test.after(() => redis.server.close());

const SECRET = "whsec_fake";

// Every test gets its own slug, starting from its own known quantity, so the
// suite can run in any order without one test's decrement leaking into
// another's assertion.
let slugCounter = 0;
async function seedPiece(quantity) {
  const slug = `webhook-piece-${++slugCounter}`;
  await inv.upsertPiece({ slug, title: "Test Piece", price: 100, quantity, notes: "" });
  return slug;
}

function completedEvent(slug, paymentStatus) {
  return JSON.stringify({
    type: "checkout.session.completed",
    data: { object: { payment_status: paymentStatus, metadata: { slug } } },
  });
}

function asyncSucceededEvent(slug, paymentStatus) {
  return JSON.stringify({
    type: "checkout.session.async_payment_succeeded",
    data: { object: { payment_status: paymentStatus, metadata: { slug } } },
  });
}

async function post(rawBody, headers) {
  const req = makeStreamReq({ rawBody, headers });
  const res = makeRes();
  await handler(req, res);
  return res;
}

async function quantityOf(slug) {
  return (await inv.getRow(slug)).quantity;
}

test("a correctly signed completed-and-paid session decrements stock by one", async () => {
  process.env.STRIPE_WEBHOOK = SECRET;
  const slug = await seedPiece(3);
  const payload = completedEvent(slug, "paid");
  const signature = stripeSignature({ payload, secret: SECRET });

  const res = await post(payload, { "stripe-signature": signature });

  assert.equal(res.statusCode, 200);
  assert.equal(await quantityOf(slug), 2);
});

test("a forged signature is rejected and does not touch stock", async () => {
  process.env.STRIPE_WEBHOOK = SECRET;
  const slug = await seedPiece(3);
  const payload = completedEvent(slug, "paid");
  const forged = stripeSignature({ payload, secret: "whsec_someone_elses" });

  const res = await post(payload, { "stripe-signature": forged });

  assert.notEqual(res.statusCode, 200);
  assert.equal(await quantityOf(slug), 3);
});

test("a missing Stripe-Signature header is rejected and does not touch stock", async () => {
  process.env.STRIPE_WEBHOOK = SECRET;
  const slug = await seedPiece(3);
  const payload = completedEvent(slug, "paid");

  const res = await post(payload, {});

  assert.notEqual(res.statusCode, 200);
  assert.equal(await quantityOf(slug), 3);
});

test("a valid but stale signature is rejected and does not touch stock", async () => {
  process.env.STRIPE_WEBHOOK = SECRET;
  const slug = await seedPiece(3);
  const payload = completedEvent(slug, "paid");
  // Older than MAX_AGE_SECONDS (5 minutes) in api/stripe-webhook.ts.
  const stale = stripeSignature({ payload, secret: SECRET, timestamp: Math.floor(Date.now() / 1000) - 10 * 60 });

  const res = await post(payload, { "stripe-signature": stale });

  assert.notEqual(res.statusCode, 200);
  assert.equal(await quantityOf(slug), 3);
});

test("a body swapped out after signing is rejected and does not touch stock", async () => {
  process.env.STRIPE_WEBHOOK = SECRET;
  const slug = await seedPiece(3);
  const signedPayload = completedEvent(slug, "paid");
  const signature = stripeSignature({ payload: signedPayload, secret: SECRET });
  // Same signature, different bytes on the wire.
  const tamperedPayload = completedEvent(slug, "paid").replace('"paid"', '"paid","x":"1"');

  const res = await post(tamperedPayload, { "stripe-signature": signature });

  assert.notEqual(res.statusCode, 200);
  assert.equal(await quantityOf(slug), 3);
});

test("a rotation header accepted on its second v1 still decrements", async () => {
  process.env.STRIPE_WEBHOOK = SECRET;
  const slug = await seedPiece(3);
  const payload = completedEvent(slug, "paid");
  const good = stripeSignature({ payload, secret: SECRET });
  const [tPart, v1Part] = good.split(",");
  // Old secret's signature first, then the one that actually matches —
  // Stripe sends both during a signing-secret rotation.
  const wrongV1 = `v1=${"0".repeat(64)}`;
  const header = `${tPart},${wrongV1},${v1Part}`;

  const res = await post(payload, { "stripe-signature": header });

  assert.equal(res.statusCode, 200);
  assert.equal(await quantityOf(slug), 2);
});

test("a zero-cost session still decrements, since no_payment_required means paid", async () => {
  // The handler treats "no_payment_required" as settled alongside "paid".
  // Without this, a legitimately free or fully-discounted order would leave
  // the piece listed as available after it had gone.
  process.env.STRIPE_WEBHOOK = SECRET;
  const slug = await seedPiece(2);
  const payload = completedEvent(slug, "no_payment_required");
  const signature = stripeSignature({ payload, secret: SECRET });

  const res = await post(payload, { "stripe-signature": signature });

  assert.equal(res.statusCode, 200);
  assert.equal(await quantityOf(slug), 1);
});

test("payment_status unpaid does not decrement even on the right event type", async () => {
  process.env.STRIPE_WEBHOOK = SECRET;
  const slug = await seedPiece(3);
  const payload = completedEvent(slug, "unpaid");
  const signature = stripeSignature({ payload, secret: SECRET });

  const res = await post(payload, { "stripe-signature": signature });

  assert.equal(res.statusCode, 200);
  assert.equal(await quantityOf(slug), 3);
});

test("an async payment that clears afterward decrements once it's paid", async () => {
  process.env.STRIPE_WEBHOOK = SECRET;
  const slug = await seedPiece(3);
  const payload = asyncSucceededEvent(slug, "paid");
  const signature = stripeSignature({ payload, secret: SECRET });

  const res = await post(payload, { "stripe-signature": signature });

  assert.equal(res.statusCode, 200);
  assert.equal(await quantityOf(slug), 2);
});

test("an expired session is acknowledged but does not decrement", async () => {
  process.env.STRIPE_WEBHOOK = SECRET;
  const slug = await seedPiece(3);
  const payload = JSON.stringify({
    type: "checkout.session.expired",
    data: { object: { payment_status: "unpaid", metadata: { slug } } },
  });
  const signature = stripeSignature({ payload, secret: SECRET });

  const res = await post(payload, { "stripe-signature": signature });

  assert.equal(res.statusCode, 200);
  assert.equal(await quantityOf(slug), 3);
});

test("a failed async payment is acknowledged but does not decrement", async () => {
  process.env.STRIPE_WEBHOOK = SECRET;
  const slug = await seedPiece(3);
  const payload = JSON.stringify({
    type: "checkout.session.async_payment_failed",
    data: { object: { payment_status: "unpaid", metadata: { slug } } },
  });
  const signature = stripeSignature({ payload, secret: SECRET });

  const res = await post(payload, { "stripe-signature": signature });

  assert.equal(res.statusCode, 200);
  assert.equal(await quantityOf(slug), 3);
});

test("a non-sale event type does not decrement even with payment_status paid", async () => {
  process.env.STRIPE_WEBHOOK = SECRET;
  const slug = await seedPiece(3);
  // Same shape as a real sale (paid, carries the slug) but not an event type
  // this handler is supposed to act on — only the type filter stands between
  // this and a decrement.
  const payload = JSON.stringify({
    type: "payment_intent.succeeded",
    data: { object: { payment_status: "paid", metadata: { slug } } },
  });
  const signature = stripeSignature({ payload, secret: SECRET });

  const res = await post(payload, { "stripe-signature": signature });

  assert.equal(res.statusCode, 200);
  assert.equal(await quantityOf(slug), 3);
});

test("a missing STRIPE_WEBHOOK env var fails closed", async () => {
  const slug = await seedPiece(3);
  const payload = completedEvent(slug, "paid");
  // Sign with the empty string, not SECRET: an attacker doesn't know the
  // real secret, but if the guard were gone and the handler fell through to
  // `process.env.STRIPE_WEBHOOK || ""`, this is exactly the signature that
  // would verify. Signing with SECRET here would pass even without the
  // guard, since it just wouldn't match either way — that proves nothing.
  const signature = stripeSignature({ payload, secret: "" });
  delete process.env.STRIPE_WEBHOOK;

  try {
    const res = await post(payload, { "stripe-signature": signature });
    assert.notEqual(res.statusCode, 200);
    assert.equal(await quantityOf(slug), 3);
  } finally {
    process.env.STRIPE_WEBHOOK = SECRET;
  }
});
