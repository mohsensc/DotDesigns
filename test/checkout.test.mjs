// Tests for api/checkout.ts — the one place a buyer's own input touches
// money. Price and quantity come from Redis, never from the request body;
// these tests exist to catch the day that stops being true.
//
//   node --test test/checkout.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import {
  bundle,
  makeReq,
  makeRes,
  startFakeRedis,
  startFakeStripe,
  stubFetch,
} from "./helpers.mjs";

const redis = await startFakeRedis();
process.env.KV_REST_API_URL = redis.url;
process.env.KV_REST_API_TOKEN = redis.token;

const inv = await import(bundle("api/_lib/inventory.ts"));
const { default: handler } = await import(bundle("api/checkout.ts"));

test.after(() => redis.server.close());

let seq = 0;
// Every test gets its own slug so a leftover row from one test can't answer
// a different test's read.
function nextSlug(prefix) {
  seq += 1;
  return `${prefix}-${seq}`;
}

async function seed(slug, { price = 500, quantity = 1, title = "A Piece" } = {}) {
  await inv.upsertPiece({ slug, title, price, quantity, notes: "" });
  return slug;
}

// Wires up a fake Stripe plus a fetch stub that routes both Stripe and the
// fake Redis through it, and hands back a restore function that undoes both.
async function withStripe(respond) {
  const stripe = await startFakeStripe(respond ? { respond } : undefined);
  const restore = stubFetch({
    "https://api.stripe.com": stripe.url,
    [redis.url]: redis.url,
  });
  return {
    stripe,
    async cleanup() {
      restore();
      await new Promise((resolve) => stripe.server.close(resolve));
    },
  };
}

test("the buyer's own price, amount, currency and quantity are ignored", async () => {
  const slug = await seed(nextSlug("bowl"), { price: 500, quantity: 3 });
  const { stripe, cleanup } = await withStripe();
  try {
    const req = makeReq({
      method: "POST",
      body: { slug, price: 1, amount: 1, currency: "usd", quantity: 99 },
    });
    const res = makeRes();
    process.env.STRIPE_KEY = "sk_test_fake";

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(stripe.calls.length, 1, "exactly one Stripe session should be created");
    const call = stripe.calls[0].body;
    // 500 dollars, from Redis, not the 1 the buyer sent.
    assert.equal(call["line_items[0][price_data][unit_amount]"], "50000");
    assert.equal(call["line_items[0][price_data][currency]"], "cad", "currency is not the buyer's to pick");
    assert.equal(call["line_items[0][quantity]"], "1", "quantity is not the buyer's to pick");
  } finally {
    await cleanup();
  }
});

test("a fractional dollar price converts to cents correctly", async () => {
  const slug = await seed(nextSlug("fraction"), { price: 1200.5, quantity: 1 });
  const { stripe, cleanup } = await withStripe();
  try {
    process.env.STRIPE_KEY = "sk_test_fake";
    const res = makeRes();
    await handler(makeReq({ method: "POST", body: { slug } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(stripe.calls[0].body["line_items[0][price_data][unit_amount]"], "120050");
  } finally {
    await cleanup();
  }
});

test("a large dollar price converts to cents correctly", async () => {
  const slug = await seed(nextSlug("large"), { price: 10000, quantity: 1 });
  const { stripe, cleanup } = await withStripe();
  try {
    process.env.STRIPE_KEY = "sk_test_fake";
    const res = makeRes();
    await handler(makeReq({ method: "POST", body: { slug } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(stripe.calls[0].body["line_items[0][price_data][unit_amount]"], "1000000");
  } finally {
    await cleanup();
  }
});

test("a sold out piece is refused and Stripe is never contacted", async () => {
  const slug = await seed(nextSlug("soldout"), { price: 500, quantity: 0 });
  const { stripe, cleanup } = await withStripe();
  try {
    process.env.STRIPE_KEY = "sk_test_fake";
    const res = makeRes();
    await handler(makeReq({ method: "POST", body: { slug } }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(stripe.calls.length, 0, "no Stripe session for a sold out piece");
  } finally {
    await cleanup();
  }
});

test("a piece with no price set is refused and Stripe is never contacted", async () => {
  const slug = await seed(nextSlug("noprice"), { price: null, quantity: 5 });
  const { stripe, cleanup } = await withStripe();
  try {
    process.env.STRIPE_KEY = "sk_test_fake";
    const res = makeRes();
    await handler(makeReq({ method: "POST", body: { slug } }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(stripe.calls.length, 0, "no Stripe session when there is nothing to charge");
  } finally {
    await cleanup();
  }
});

test("an unknown slug is refused and Stripe is never contacted", async () => {
  const { stripe, cleanup } = await withStripe();
  try {
    process.env.STRIPE_KEY = "sk_test_fake";
    const res = makeRes();
    await handler(makeReq({ method: "POST", body: { slug: nextSlug("ghost") } }), res);
    assert.equal(res.statusCode, 404);
    assert.equal(stripe.calls.length, 0);
  } finally {
    await cleanup();
  }
});

test("a missing STRIPE_KEY fails closed and makes no Stripe call", async () => {
  const slug = await seed(nextSlug("nokey"), { price: 500, quantity: 1 });
  const { stripe, cleanup } = await withStripe();
  const previousKey = process.env.STRIPE_KEY;
  try {
    delete process.env.STRIPE_KEY;
    const res = makeRes();
    await handler(makeReq({ method: "POST", body: { slug } }), res);
    assert.equal(res.statusCode, 500);
    assert.equal(stripe.calls.length, 0, "checkout must not reach Stripe with no key configured");
  } finally {
    if (previousKey !== undefined) process.env.STRIPE_KEY = previousKey;
    await cleanup();
  }
});

test("the slug is sent as metadata so the webhook knows what sold", async () => {
  const slug = await seed(nextSlug("metadata"), { price: 500, quantity: 1 });
  const { stripe, cleanup } = await withStripe();
  try {
    process.env.STRIPE_KEY = "sk_test_fake";
    const res = makeRes();
    await handler(makeReq({ method: "POST", body: { slug } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(stripe.calls[0].body["metadata[slug]"], slug);
  } finally {
    await cleanup();
  }
});

test("a spoofed X-Forwarded-Host does not end up in success_url", async () => {
  const slug = await seed(nextSlug("spoof"), { price: 500, quantity: 1 });
  const { stripe, cleanup } = await withStripe();
  try {
    process.env.STRIPE_KEY = "sk_test_fake";
    const res = makeRes();
    await handler(
      makeReq({
        method: "POST",
        body: { slug },
        headers: { "x-forwarded-host": "evil.example.com", "x-forwarded-proto": "https" },
      }),
      res,
    );
    assert.equal(res.statusCode, 200);
    const successUrl = stripe.calls[0].body.success_url;
    const cancelUrl = stripe.calls[0].body.cancel_url;
    assert.ok(!successUrl.includes("evil.example.com"), "spoofed host must not reach success_url");
    assert.ok(successUrl.startsWith("https://dotdesigns.art/"), "falls back to the canonical origin");
    assert.ok(cancelUrl.startsWith("https://dotdesigns.art/"));
  } finally {
    await cleanup();
  }
});

test("a legitimate vercel.app preview host is honoured in success_url", async () => {
  const slug = await seed(nextSlug("preview"), { price: 500, quantity: 1 });
  const { stripe, cleanup } = await withStripe();
  try {
    process.env.STRIPE_KEY = "sk_test_fake";
    const res = makeRes();
    await handler(
      makeReq({
        method: "POST",
        body: { slug },
        headers: { "x-forwarded-host": "dotdesigns-git-feat.vercel.app", "x-forwarded-proto": "https" },
      }),
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.ok(
      stripe.calls[0].body.success_url.startsWith("https://dotdesigns-git-feat.vercel.app/"),
      "a real preview host should be honoured",
    );
  } finally {
    await cleanup();
  }
});

test("the production host is honoured in success_url", async () => {
  const slug = await seed(nextSlug("prod"), { price: 500, quantity: 1 });
  const { stripe, cleanup } = await withStripe();
  try {
    process.env.STRIPE_KEY = "sk_test_fake";
    const res = makeRes();
    await handler(
      makeReq({
        method: "POST",
        body: { slug },
        headers: { "x-forwarded-host": "dotdesigns.art", "x-forwarded-proto": "https" },
      }),
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.ok(stripe.calls[0].body.success_url.startsWith("https://dotdesigns.art/"));
  } finally {
    await cleanup();
  }
});

test("a non-2xx from Stripe becomes a 5xx and does not leak Stripe's response", async () => {
  const slug = await seed(nextSlug("stripefail"), { price: 500, quantity: 1 });
  const secretDetail = "acct_super_secret_detail_should_not_leak";
  const { stripe, cleanup } = await withStripe(() => ({
    status: 402,
    body: { error: { message: secretDetail } },
  }));
  try {
    process.env.STRIPE_KEY = "sk_test_fake";
    const res = makeRes();
    await handler(makeReq({ method: "POST", body: { slug } }), res);
    assert.equal(res.statusCode, 502);
    const rendered = JSON.stringify(res.body);
    assert.ok(!rendered.includes(secretDetail), "Stripe's response body must never reach the caller");
  } finally {
    await cleanup();
  }
});
