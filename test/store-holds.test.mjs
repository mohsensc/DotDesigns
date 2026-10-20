import test from "node:test";
import assert from "node:assert/strict";
import {
  bundle,
  makeReq,
  makeRes,
  makeStreamReq,
  startFakeRedis,
  startFakeStripe,
  stripeSignature,
  stubFetch,
} from "./helpers.mjs";

const redis = await startFakeRedis();
process.env.KV_REST_API_URL = redis.url;
process.env.KV_REST_API_TOKEN = redis.token;
process.env.STRIPE_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK = "whsec_fake";

const inv = await import(bundle("api/_lib/inventory.ts"));
const redisClient = await import(bundle("api/_lib/redis.ts"));
const { default: checkout } = await import(bundle("api/checkout.ts"));
const { default: webhook } = await import(bundle("api/stripe-webhook.ts"));

test.after(() => redis.server.close());

let seq = 0;
async function seed(quantity, price = 500) {
  const slug = `held-${++seq}`;
  await inv.upsertPiece({ slug, title: "Held Piece", price, quantity, notes: "" });
  return slug;
}

async function withStripe(respond) {
  const stripe = await startFakeStripe(respond ? { respond } : undefined);
  const restore = stubFetch({ "https://api.stripe.com": stripe.url, [redis.url]: redis.url });
  return {
    stripe,
    async cleanup() {
      restore();
      await new Promise(resolve => stripe.server.close(resolve));
    },
  };
}

async function buy(slug, body = {}) {
  const res = makeRes();
  await checkout(makeReq({ method: "POST", body: { slug, ...body } }), res);
  return res;
}

async function stripeEvent(type, object) {
  const payload = JSON.stringify({ id: `evt_${++seq}`, type, data: { object } });
  const res = makeRes();
  await webhook(
    makeStreamReq({
      rawBody: payload,
      headers: { "stripe-signature": stripeSignature({ payload, secret: "whsec_fake" }) },
    }),
    res,
  );
  return res;
}

async function setCatalogStatus(slug, status) {
  const catalog = { version: 1, updatedAt: "t", pieces: [{ id: `id-${slug}`, slug, status, order: 1 }] };
  await redisClient.command(["SET", "catalog:v1", JSON.stringify(catalog)]);
}

test.afterEach(async () => {
  await redisClient.command(["DEL", "catalog:v1"]);
});

test("the last piece goes to one buyer at a time", async () => {
  const slug = await seed(1);
  const { stripe, cleanup } = await withStripe();
  try {
    const first = await buy(slug);
    const second = await buy(slug);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 409);
    assert.equal(stripe.calls.length, 1);
  } finally {
    await cleanup();
  }
});

test("two in stock means two buyers, not three", async () => {
  const slug = await seed(2);
  const { cleanup } = await withStripe();
  try {
    assert.equal((await buy(slug)).statusCode, 200);
    assert.equal((await buy(slug)).statusCode, 200);
    assert.equal((await buy(slug)).statusCode, 409);
  } finally {
    await cleanup();
  }
});

test("the same buyer retrying with the same hold id is not blocked by themselves", async () => {
  const slug = await seed(1);
  const { cleanup } = await withStripe();
  try {
    assert.equal((await buy(slug, { holdId: "page-nonce-1" })).statusCode, 200);
    assert.equal((await buy(slug, { holdId: "page-nonce-1" })).statusCode, 200);
    assert.equal((await buy(slug, { holdId: "page-nonce-2" })).statusCode, 409);
  } finally {
    await cleanup();
  }
});

test("no Idempotency-Key is sent and the session expires in 30 minutes or more", async () => {
  const slug = await seed(1);
  const { stripe, cleanup } = await withStripe();
  try {
    await buy(slug);
    const call = stripe.calls[0];
    assert.equal(call.headers["idempotency-key"], undefined);
    const lifetime = Number(call.body.expires_at) - Date.now() / 1000;
    assert.ok(lifetime >= 30 * 60, `lifetime ${lifetime}`);
    assert.ok(call.body["metadata[holdId]"]);
  } finally {
    await cleanup();
  }
});

test("a failed Stripe call gives the piece back", async () => {
  const slug = await seed(1);
  const { cleanup } = await withStripe(() => ({ status: 500, body: {} }));
  try {
    assert.equal((await buy(slug)).statusCode, 502);
  } finally {
    await cleanup();
  }
  const retry = await withStripe();
  try {
    assert.equal((await buy(slug)).statusCode, 200);
  } finally {
    await retry.cleanup();
  }
});

test("a hold that ran out frees the piece without any webhook", async () => {
  const slug = await seed(1);
  assert.equal(await inv.holdPiece(slug, "abandoned-1", Date.now() - inv.HOLD_MS - 1000), "held");
  assert.equal(await inv.holdPiece(slug, "fresh-buyer-1"), "held");
});

test("a buyer retrying near the end of their hold gets a fresh window", async () => {
  const slug = await seed(1);
  const start = Date.now();
  assert.equal(await inv.holdPiece(slug, "returning-1", start), "held");
  const retry = start + inv.HOLD_MS - 60_000;
  assert.equal(await inv.holdPiece(slug, "returning-1", retry), "held");
  assert.equal(await inv.holdPiece(slug, "someone-else", start + inv.HOLD_MS + 1000), "busy");
});

test("an expired session frees the piece", async () => {
  const slug = await seed(1);
  const { stripe, cleanup } = await withStripe();
  try {
    await buy(slug);
    assert.equal((await buy(slug)).statusCode, 409);
    const { "metadata[holdId]": holdId } = stripe.calls[0].body;
    const res = await stripeEvent("checkout.session.expired", { id: "cs_1", metadata: { slug, holdId } });
    assert.equal(res.statusCode, 200);
    assert.equal((await buy(slug)).statusCode, 200);
  } finally {
    await cleanup();
  }
});

test("a paid session takes the stock once, even when Stripe redelivers it", async () => {
  const slug = await seed(5);
  const { stripe, cleanup } = await withStripe();
  try {
    await buy(slug);
    const metadata = { slug, holdId: stripe.calls[0].body["metadata[holdId]"] };
    const session = { id: "cs_paid_1", payment_status: "paid", metadata };
    assert.equal((await stripeEvent("checkout.session.completed", session)).statusCode, 200);
    assert.equal((await stripeEvent("checkout.session.completed", session)).statusCode, 200);
    assert.equal((await stripeEvent("checkout.session.async_payment_succeeded", session)).statusCode, 200);
    assert.equal((await inv.getRow(slug)).quantity, 4);
  } finally {
    await cleanup();
  }
});

test("a paid sale with nothing left is logged loudly for a refund", async () => {
  const slug = await seed(0);
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const res = await stripeEvent("checkout.session.completed", {
      id: "cs_late",
      payment_status: "paid",
      metadata: { slug },
    });
    assert.equal(res.statusCode, 200);
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /Refund/);
});

test("when the stock write fails the webhook answers 500 so Stripe retries", async () => {
  const slug = await seed(1);
  const saved = process.env.KV_REST_API_URL;
  process.env.KV_REST_API_URL = "http://127.0.0.1:1";
  const original = console.error;
  console.error = () => undefined;
  let res;
  try {
    res = await stripeEvent("checkout.session.completed", {
      id: "cs_retry",
      payment_status: "paid",
      metadata: { slug },
    });
  } finally {
    console.error = original;
    process.env.KV_REST_API_URL = saved;
  }
  assert.equal(res.statusCode, 500);
  const retried = await stripeEvent("checkout.session.completed", {
    id: "cs_retry",
    payment_status: "paid",
    metadata: { slug },
  });
  assert.equal(retried.statusCode, 200);
  assert.equal((await inv.getRow(slug)).quantity, 0);
});

test("reserved, draft and sold pieces cannot be checked out", async () => {
  const slug = await seed(1);
  const { stripe, cleanup } = await withStripe();
  try {
    for (const status of ["reserved", "draft", "sold"]) {
      await setCatalogStatus(slug, status);
      assert.equal((await buy(slug)).statusCode, 409, status);
    }
    assert.equal(stripe.calls.length, 0);
    await setCatalogStatus(slug, "available");
    assert.equal((await buy(slug)).statusCode, 200);
  } finally {
    await cleanup();
  }
});

test("a price under fifty cents is not sent to Stripe", async () => {
  const slug = await seed(1, 0.2);
  const { stripe, cleanup } = await withStripe();
  try {
    assert.equal((await buy(slug)).statusCode, 409);
    assert.equal(stripe.calls.length, 0);
  } finally {
    await cleanup();
  }
});

test("a dead ledger answers 503 like the inventory endpoint", async () => {
  const savedUrl = process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_URL;
  try {
    const res = await buy("anything");
    assert.equal(res.statusCode, 503);
  } finally {
    process.env.KV_REST_API_URL = savedUrl;
  }
});
