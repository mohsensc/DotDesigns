// Tests for the public inventory read: api/inventory.ts on the server, and
// client/src/lib/inventory.ts's fetch wrapper. Both sides exist to fail
// soft — the worst outcome here isn't a wrong number, it's the whole shop
// looking sold out because a read hiccuped.
//
//   node --test test/shop-read.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { bundle, makeReq, makeRes, startFakeRedis } from "./helpers.mjs";

const redis = await startFakeRedis();
test.after(() => redis.server.close());

// api/_lib/inventory.ts's upsertPiece is how we seed stock for the handler
// to read back — the handler itself only reads.
const invLib = await import(bundle("api/_lib/inventory.ts"));
const { default: handler } = await import(bundle("api/inventory.ts"));

function clearRedisEnv() {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
}

function useRedis() {
  process.env.KV_REST_API_URL = redis.url;
  process.env.KV_REST_API_TOKEN = redis.token;
}

// --- server: api/inventory.ts ----------------------------------------------

test("with redis unconfigured, GET /api/inventory answers 200 with no pieces", async () => {
  clearRedisEnv();
  const res = makeRes();
  await handler(makeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 200, "must not be a 500 — the shop still has to render");
  assert.deepEqual(res.body, { pieces: {} });
});

test("when the redis call throws, the read still answers 200 with no pieces", async () => {
  // A real server, wrong token: command() gets a 401 and throws, same as any
  // other storage hiccup would.
  process.env.KV_REST_API_URL = redis.url;
  process.env.KV_REST_API_TOKEN = "wrong-token";
  const res = makeRes();
  await handler(makeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { pieces: {} });
});

test("stock present: price, quantity and soldOut are reported correctly", async () => {
  useRedis();
  await invLib.upsertPiece({ slug: "read-in-stock", title: "In Stock", price: 500, quantity: 3, notes: "" });
  await invLib.upsertPiece({ slug: "read-sold-out", title: "Sold Out", price: 200, quantity: 0, notes: "" });

  const res = makeRes();
  await handler(makeReq({ method: "GET" }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.pieces["read-in-stock"], { price: 500, quantity: 3, soldOut: false });
  assert.deepEqual(res.body.pieces["read-sold-out"], { price: 200, quantity: 0, soldOut: true });
});

test("the response never carries the private notes field", async () => {
  useRedis();
  const secret = "bought at the estate sale for $40, never quote this to a buyer";
  await invLib.upsertPiece({ slug: "read-notes-check", title: "Notes Check", price: 300, quantity: 1, notes: secret });

  const res = makeRes();
  await handler(makeReq({ method: "GET" }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body).includes(secret), false, "notes leaked into the public response");
});

test("a non-GET method is refused", async () => {
  useRedis();
  const res = makeRes();
  await handler(makeReq({ method: "POST" }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET");
});

// --- client: client/src/lib/inventory.ts -----------------------------------
//
// loadInventory() caches its promise at module scope, so each case below
// imports the bundle under its own query string to get a fresh module
// instance instead of hitting the previous test's cached result.

const clientBundle = bundle("client/src/lib/inventory.ts");

function stubGlobalFetch(fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  return () => {
    globalThis.fetch = original;
  };
}

async function freshClientModule(tag) {
  return import(`${pathToFileURL(clientBundle).href}?case=${tag}`);
}

test("client: a rejected fetch resolves to an empty object instead of throwing", async () => {
  const restore = stubGlobalFetch(async () => {
    throw new Error("network down");
  });
  try {
    const client = await freshClientModule("reject");
    const result = await client.loadInventory();
    assert.deepEqual(result, {}, "a network blip must fall back to the catalog, not hang or throw");
  } finally {
    restore();
  }
});

test("client: a 500 response resolves to an empty object instead of trusting the body", async () => {
  // The body carries a "pieces" entry that would only show up if the ok-check
  // were removed — proving the guard, not just the status code, is doing the work.
  const restore = stubGlobalFetch(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ pieces: { "trap-slug": { price: 999, quantity: 5, soldOut: false } } }),
  }));
  try {
    const client = await freshClientModule("500");
    const result = await client.loadInventory();
    assert.deepEqual(result, {}, "an error response body must never be trusted as stock");
  } finally {
    restore();
  }
});
