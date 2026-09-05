// Tests for the inventory ledger — the code that decides what a buyer is
// charged and whether a piece is still for sale. It's the only part of this
// repo where a bug costs real money, so it's the part that gets tested.
//
//   node --test test/
//
// The module is TypeScript and imports without file extensions, so it's
// bundled through esbuild (already present as a Vite dependency) and driven
// against a fake Redis over real HTTP.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeRedis } from "./fake-redis.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(path.join(tmpdir(), "dot-inv-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));

const bundle = path.join(work, "inventory.mjs");
execFileSync(
  path.join(repoRoot, "node_modules/.bin/esbuild"),
  [
    path.join(repoRoot, "api/_lib/inventory.ts"),
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--outfile=${bundle}`,
  ],
  { stdio: "pipe" },
);

const redis = await startFakeRedis();
process.env.KV_REST_API_URL = redis.url;
process.env.KV_REST_API_TOKEN = redis.token;
const inv = await import(bundle);
test.after(() => redis.server.close());

// --- reading what a person typed ------------------------------------------
// The severe case is a cell holding more than one number. Stripping every
// non-digit turns "1200 (was 1500)" into 12001500 and charges twelve million
// dollars for a twelve hundred dollar piece.
test("parseAmount takes one number or nothing", () => {
  assert.equal(inv.parseAmount("1200"), 1200);
  assert.equal(inv.parseAmount("$1,200"), 1200);
  assert.equal(inv.parseAmount("  1200  "), 1200);
  assert.equal(inv.parseAmount("1200.50"), 1200.5);
  assert.equal(inv.parseAmount("$10,000"), 10000);
  assert.equal(inv.parseAmount(640), 640);

  assert.equal(inv.parseAmount("1200 (was 1500)"), null, "two numbers must refuse");
  assert.equal(inv.parseAmount("1200, reduced from 1500"), null);
  assert.equal(inv.parseAmount("1200-1500"), null, "a range is not a price");
  assert.equal(inv.parseAmount("-50"), null, "negative must not become positive");
  assert.equal(inv.parseAmount("sold"), null);
  assert.equal(inv.parseAmount("price on request"), null);
  assert.equal(inv.parseAmount(""), null);
  assert.equal(inv.parseAmount(undefined), null);
});

test("an ambiguous quantity reads as sold out, not as stock", () => {
  assert.equal(inv.parseQuantity("2"), 2);
  // One number plus words is not ambiguous — there's only one count in there.
  assert.equal(inv.parseQuantity("2 left"), 2);
  // Two numbers is ambiguous, and guessing high would oversell.
  assert.equal(inv.parseQuantity("2 or 3"), 0);
  assert.equal(inv.parseQuantity(""), 0);
});

// --- the round trip --------------------------------------------------------
test("a piece survives a save and read back intact", async () => {
  await inv.upsertPiece({ slug: "ash-bowl", title: "Ash Bowl", price: 500, quantity: 2, notes: "" });
  const row = await inv.getRow("ash-bowl");
  assert.equal(row.price, 500);
  assert.equal(row.quantity, 2);
  assert.equal(inv.isSoldOut(row), false);
});

test("a blank price stays null so it can never be charged as zero", async () => {
  await inv.upsertPiece({
    slug: "wave-wall",
    title: "The Wave Wall",
    price: null,
    quantity: 1,
    notes: "quote per wall",
  });
  const row = await inv.getRow("wave-wall");
  assert.equal(row.price, null);
  assert.equal(row.notes, "quote per wall");
});

test("an unknown slug is null rather than an empty row", async () => {
  assert.equal(await inv.getRow("no-such-piece"), null);
});

test("the listing returns everything saved", async () => {
  const all = await inv.getInventory();
  assert.deepEqual([...all.keys()].sort(), ["ash-bowl", "wave-wall"]);
});

// --- selling ---------------------------------------------------------------
test("stock runs down and then refuses to go further", async () => {
  assert.equal(await inv.decrementQuantity("ash-bowl", 1), 1);
  assert.equal(await inv.decrementQuantity("ash-bowl", 1), 0);
  assert.equal(inv.isSoldOut(await inv.getRow("ash-bowl")), true);

  // The one that matters: selling a sold-out piece must report that there was
  // nothing left, and must not leave a negative quantity behind.
  assert.equal(await inv.decrementQuantity("ash-bowl", 1), -1);
  assert.equal((await inv.getRow("ash-bowl")).quantity, 0);
});

test("restocking brings it back", async () => {
  await inv.setQuantity("ash-bowl", 3);
  assert.equal((await inv.getRow("ash-bowl")).quantity, 3);
});

test("editing a piece updates it rather than adding a second one", async () => {
  await inv.upsertPiece({ slug: "ash-bowl", title: "Ash Bowl", price: 550, quantity: 3, notes: "" });
  assert.equal((await inv.getRow("ash-bowl")).price, 550);
  assert.equal((await inv.getInventory()).size, 2);
});

test("removing a piece clears both the listing and the row", async () => {
  await inv.removePiece("wave-wall");
  assert.deepEqual([...(await inv.getInventory()).keys()], ["ash-bowl"]);
  assert.equal(await inv.getRow("wave-wall"), null);
});

test("only real Redis commands were issued", () => {
  const known = new Set(["SET", "GET", "MGET", "DEL", "SADD", "SREM", "SISMEMBER", "SMEMBERS", "EVAL"]);
  const unknown = [...new Set(redis.issued)].filter(c => !known.has(c));
  assert.deepEqual(unknown, []);
});
