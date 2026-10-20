import test from "node:test";
import assert from "node:assert/strict";
import { bundle, makeReq, makeRes, startFakeRedis } from "./helpers.mjs";

const redis = await startFakeRedis();
process.env.KV_REST_API_URL = redis.url;
process.env.KV_REST_API_TOKEN = redis.token;
process.env.PASSWORD = "correct-horse";
test.after(() => redis.server.close());

const { default: catalogHandler } = await import(bundle("api/studio-catalog.ts"));
const { default: inventoryHandler } = await import(bundle("api/studio-inventory.ts"));
const inv = await import(bundle("api/_lib/inventory.ts"));
const catalogLib = await import(bundle("api/_lib/catalog.ts"));
const session = await import(bundle("api/_lib/studio-session.ts"));

const cookies = { [session.STUDIO_COOKIE_NAME]: session.issueStudioToken("correct-horse") };

async function call(handler, opts) {
  const res = makeRes();
  await handler(makeReq({ cookies, ...opts }), res);
  return res;
}

const callCatalog = opts => call(catalogHandler, opts);
const callInventory = opts => call(inventoryHandler, opts);

function pieceBody(overrides = {}) {
  return {
    id: "p-vase",
    slug: "vase",
    title: "Vase",
    category: "pottery",
    status: "available",
    price: 300,
    blurb: "",
    description: "",
    media: [],
    order: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function currentStamp() {
  const res = await callCatalog({ method: "GET" });
  return res.body.catalog.updatedAt;
}

async function save(piece, extra = {}) {
  return callCatalog({
    method: "PUT",
    body: { piece, notes: "", expectedUpdatedAt: await currentStamp(), ...extra },
  });
}

test("every method needs a session", async () => {
  for (const method of ["GET", "PUT", "POST", "DELETE"]) {
    const res = makeRes();
    await catalogHandler(makeReq({ method }), res);
    assert.equal(res.statusCode, 401, method);
  }
});

test("a new piece needs a quantity and gets one row", async () => {
  const missing = await save(pieceBody({ id: "p-new", slug: "new" }));
  assert.equal(missing.statusCode, 400);
  const res = await save(pieceBody({ id: "p-new", slug: "new" }), { quantity: 2 });
  assert.equal(res.statusCode, 200);
  const row = await inv.getRow("new");
  assert.equal(row.quantity, 2);
  assert.equal(row.price, 300);
});

test("saving a caption after a sale does not put the sold piece back on sale", async () => {
  await save(pieceBody(), { quantity: 1 });
  await inv.decrementQuantity("vase", 1);
  const res = await save(pieceBody({ blurb: "fixed a typo" }), { quantity: 1, expectedQuantity: 1 });
  assert.equal(res.statusCode, 200);
  assert.equal((await inv.getRow("vase")).quantity, 0);
});

test("changing the count after a sale is refused instead of overwriting it", async () => {
  await save(pieceBody({ id: "p-two", slug: "two" }), { quantity: 3 });
  await inv.decrementQuantity("two", 1);
  const res = await save(pieceBody({ id: "p-two", slug: "two", blurb: "x" }), { quantity: 5, expectedQuantity: 3 });
  assert.equal(res.statusCode, 409);
  assert.equal((await inv.getRow("two")).quantity, 2);
});

test("changing the count when nothing moved writes it", async () => {
  await save(pieceBody({ id: "p-three", slug: "three" }), { quantity: 3 });
  const res = await save(pieceBody({ id: "p-three", slug: "three" }), { quantity: 7, expectedQuantity: 3 });
  assert.equal(res.statusCode, 200);
  assert.equal((await inv.getRow("three")).quantity, 7);
});

test("a rename carries the live count to the new address and drops the old row", async () => {
  await save(pieceBody({ id: "p-ren", slug: "old-name" }), { quantity: 4 });
  await inv.decrementQuantity("old-name", 1);
  const res = await save(pieceBody({ id: "p-ren", slug: "new-name", title: "New Name" }), {
    quantity: 4,
    expectedQuantity: 4,
  });
  assert.equal(res.statusCode, 200);
  assert.equal((await inv.getRow("new-name")).quantity, 3);
  assert.equal(await inv.getRow("old-name"), null);
});

test("a price under fifty cents is refused, blank stays allowed", async () => {
  const cheap = await save(pieceBody({ id: "p-cheap", slug: "cheap", price: 0 }), { quantity: 1 });
  assert.equal(cheap.statusCode, 400);
  const blank = await save(pieceBody({ id: "p-cheap", slug: "cheap", price: null }), { quantity: 1 });
  assert.equal(blank.statusCode, 200);
  assert.equal((await inv.getRow("cheap")).price, null);
});

test("a stale catalog stamp is a 409 with the current catalog", async () => {
  const res = await callCatalog({
    method: "PUT",
    body: { piece: pieceBody({ id: "p-stale", slug: "stale" }), quantity: 1, notes: "", expectedUpdatedAt: "old" },
  });
  assert.equal(res.statusCode, 409);
  assert.ok(res.body.catalog);
});

test("a price set in the Stock tab reaches the catalog, so the next save keeps it", async () => {
  await save(pieceBody({ id: "p-price", slug: "priced" }), { quantity: 1 });
  const stock = await callInventory({
    method: "POST",
    body: { slug: "priced", title: "Vase", price: "450", quantity: "1", expectedQuantity: "1", notes: "" },
  });
  assert.equal(stock.statusCode, 200);
  const listed = (await catalogLib.readCatalog()).pieces.find(p => p.slug === "priced");
  assert.equal(listed.price, 450);
  const edited = await save({ ...pieceBody({ id: "p-price", slug: "priced" }), price: listed.price, blurb: "new" }, {
    quantity: 1,
    expectedQuantity: 1,
  });
  assert.equal(edited.statusCode, 200);
  assert.equal((await inv.getRow("priced")).price, 450);
});

test("the Stock tab does not overwrite a sale with the count it loaded", async () => {
  await save(pieceBody({ id: "p-notes", slug: "notes" }), { quantity: 1 });
  await inv.decrementQuantity("notes", 1);
  const unchanged = await callInventory({
    method: "POST",
    body: { slug: "notes", title: "Vase", price: "300", quantity: "1", expectedQuantity: "1", notes: "typo" },
  });
  assert.equal(unchanged.statusCode, 200);
  assert.equal((await inv.getRow("notes")).quantity, 0);
  const changed = await callInventory({
    method: "POST",
    body: { slug: "notes", title: "Vase", price: "300", quantity: "5", expectedQuantity: "1", notes: "typo" },
  });
  assert.equal(changed.statusCode, 409);
  assert.equal((await inv.getRow("notes")).quantity, 0);
});

test("deleting a piece removes its stock row", async () => {
  await save(pieceBody({ id: "p-del", slug: "gone" }), { quantity: 1 });
  const res = await callCatalog({
    method: "DELETE",
    query: { id: "p-del" },
    body: { expectedUpdatedAt: await currentStamp() },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(await inv.getRow("gone"), null);
});

test("a malformed cookie is a 401, not a crash", async () => {
  const res = makeRes();
  await catalogHandler(makeReq({ method: "GET", cookies: `${session.STUDIO_COOKIE_NAME}=%E0%A4%A` }), res);
  assert.equal(res.statusCode, 401);
});
