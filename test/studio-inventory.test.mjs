// Tests for api/studio-inventory.ts — the only writable door onto the
// numbers checkout charges against. If the session check ever slipped, or
// the validation ever let a bad number through, this is where it'd show up
// as a wrong amount stored, not just a wrong status code.
//
//   node --test test/studio-inventory.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { bundle, makeReq, makeRes, startFakeRedis } from "./helpers.mjs";

const handlerMod = await import(bundle("api/studio-inventory.ts"));
const handler = handlerMod.default;
const inv = await import(bundle("api/_lib/inventory.ts"));
const session = await import(bundle("api/_lib/studio-session.ts"));

const redis = await startFakeRedis();
process.env.KV_REST_API_URL = redis.url;
process.env.KV_REST_API_TOKEN = redis.token;
test.after(() => redis.server.close());

const PASSWORD = "correct-horse";

function validCookie(password = PASSWORD) {
  return { [session.STUDIO_COOKIE_NAME]: session.expectedStudioToken(password) };
}

async function run(opts) {
  const req = makeReq(opts);
  const res = makeRes();
  await handler(req, res);
  return res;
}

// Every test sets PASSWORD itself and uses its own slug, so order doesn't matter.

test("GET is refused without a session cookie", async () => {
  process.env.PASSWORD = PASSWORD;
  const res = await run({ method: "GET" });
  assert.equal(res.statusCode, 401);
});

test("POST is refused without a session cookie, and nothing is written", async () => {
  process.env.PASSWORD = PASSWORD;
  const slug = "no-cookie-post";
  const res = await run({
    method: "POST",
    body: { slug, title: "Sneaky Bowl", price: "1", quantity: 1, notes: "" },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(await inv.getRow(slug), null, "an unauthenticated POST must not create a row");
});

test("DELETE is refused without a session cookie, and the piece survives", async () => {
  process.env.PASSWORD = PASSWORD;
  const slug = "no-cookie-delete";
  await inv.upsertPiece({ slug, title: "Standing Piece", price: 100, quantity: 1, notes: "" });
  const res = await run({ method: "DELETE", query: { slug } });
  assert.equal(res.statusCode, 401);
  assert.notEqual(await inv.getRow(slug), null, "an unauthenticated DELETE must not remove it");
});

test("a forged cookie is refused the same as no cookie at all", async () => {
  process.env.PASSWORD = PASSWORD;
  const slug = "forged-cookie";
  const res = await run({
    method: "POST",
    body: { slug, title: "Forged", price: "1", quantity: 1, notes: "" },
    cookies: { [session.STUDIO_COOKIE_NAME]: "not-a-real-token" },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(await inv.getRow(slug), null);
});

test("a cookie built for the wrong password is refused", async () => {
  process.env.PASSWORD = PASSWORD;
  const slug = "wrong-password-cookie";
  const res = await run({
    method: "POST",
    body: { slug, title: "Wrong Key", price: "1", quantity: 1, notes: "" },
    cookies: validCookie("some-other-password"),
  });
  assert.equal(res.statusCode, 401);
  assert.equal(await inv.getRow(slug), null);
});

test("with PASSWORD unset, even a cookie that would otherwise be valid authenticates nobody", async () => {
  // Build the cookie as if PASSWORD were set to this value, then unset it —
  // this is the exact shape of cookie a real session would carry if the env
  // var vanished or was never configured.
  const wouldBeToken = session.expectedStudioToken("whatever-it-was");
  delete process.env.PASSWORD;
  const slug = "no-password-configured";
  const res = await run({
    method: "POST",
    body: { slug, title: "Ghost", price: "1", quantity: 1, notes: "" },
    cookies: { [session.STUDIO_COOKIE_NAME]: wouldBeToken },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(await inv.getRow(slug), null);
});

test("a valid session can list, upsert and delete", async () => {
  process.env.PASSWORD = PASSWORD;
  const slug = "valid-session-piece";
  const cookies = validCookie();

  const create = await run({
    method: "POST",
    body: { slug, title: "Session Bowl", price: "300", quantity: 4, notes: "walnut" },
    cookies,
  });
  assert.equal(create.statusCode, 200);
  const row = await inv.getRow(slug);
  assert.equal(row.price, 300);
  assert.equal(row.quantity, 4);

  const list = await run({ method: "GET", cookies });
  assert.equal(list.statusCode, 200);
  assert.ok(list.body.rows.some(r => r.slug === slug));

  const one = await run({ method: "GET", query: { slug }, cookies });
  assert.equal(one.statusCode, 200);
  assert.equal(one.body.row.slug, slug);

  const del = await run({ method: "DELETE", query: { slug }, cookies });
  assert.equal(del.statusCode, 200);
  assert.equal(await inv.getRow(slug), null, "the delete must actually remove it");
});

// --- POST validation: refuse rather than coerce -----------------------------

test("an empty slug is refused", async () => {
  process.env.PASSWORD = PASSWORD;
  const res = await run({
    method: "POST",
    body: { slug: "", title: "Nameless", price: "1", quantity: 1, notes: "" },
    cookies: validCookie(),
  });
  assert.equal(res.statusCode, 400);
});

test("an empty title is refused, and no row is created under the slug", async () => {
  process.env.PASSWORD = PASSWORD;
  const slug = "no-title";
  const res = await run({
    method: "POST",
    body: { slug, title: "", price: "1", quantity: 1, notes: "" },
    cookies: validCookie(),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(await inv.getRow(slug), null);
});

test("a price with two numbers in it is refused rather than coerced into one", async () => {
  process.env.PASSWORD = PASSWORD;
  const slug = "ambiguous-price";
  const res = await run({
    method: "POST",
    body: { slug, title: "Ambiguous Bowl", price: "1200 (was 1500)", quantity: 1, notes: "" },
    cookies: validCookie(),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(await inv.getRow(slug), null, "must not store 1200, 1500, or 12001500");
});

test("a negative quantity is refused", async () => {
  process.env.PASSWORD = PASSWORD;
  const slug = "negative-quantity";
  const res = await run({
    method: "POST",
    body: { slug, title: "Negative", price: "1", quantity: -1, notes: "" },
    cookies: validCookie(),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(await inv.getRow(slug), null);
});

test("a non-integer quantity is refused", async () => {
  process.env.PASSWORD = PASSWORD;
  const slug = "fractional-quantity";
  const res = await run({
    method: "POST",
    body: { slug, title: "Fractional", price: "1", quantity: 2.5, notes: "" },
    cookies: validCookie(),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(await inv.getRow(slug), null);
});

test("a blank price is accepted and stores null, since blank means not for sale", async () => {
  process.env.PASSWORD = PASSWORD;
  const slug = "blank-price-piece";
  const res = await run({
    method: "POST",
    body: { slug, title: "Quote On Request", price: "", quantity: 1, notes: "commission only" },
    cookies: validCookie(),
  });
  assert.equal(res.statusCode, 200);
  const row = await inv.getRow(slug);
  assert.equal(row.price, null);
});

test("quantity 0 is accepted, since that is how a piece gets marked sold out", async () => {
  process.env.PASSWORD = PASSWORD;
  const slug = "sold-out-piece";
  const res = await run({
    method: "POST",
    body: { slug, title: "Sold Out Piece", price: "200", quantity: 0, notes: "" },
    cookies: validCookie(),
  });
  assert.equal(res.statusCode, 200);
  const row = await inv.getRow(slug);
  assert.equal(row.quantity, 0);
  assert.equal(inv.isSoldOut(row), true);
});

// --- response shape ----------------------------------------------------------

test("a listed row exposes exactly the documented fields, nothing more", async () => {
  process.env.PASSWORD = PASSWORD;
  const slug = "shape-check-piece";
  await run({
    method: "POST",
    body: { slug, title: "Shape Check", price: "50", quantity: 2, notes: "n" },
    cookies: validCookie(),
  });
  const list = await run({ method: "GET", cookies: validCookie() });
  const row = list.body.rows.find(r => r.slug === slug);
  assert.deepEqual(
    Object.keys(row).sort(),
    ["notes", "price", "quantity", "slug", "title", "updatedAt"].sort(),
  );

  const single = await run({ method: "GET", query: { slug }, cookies: validCookie() });
  assert.deepEqual(
    Object.keys(single.body.row).sort(),
    ["notes", "price", "quantity", "slug", "title", "updatedAt"].sort(),
  );
});
