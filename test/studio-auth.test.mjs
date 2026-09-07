// Tests for api/studio-auth.ts — the password door and the lockdown behind it.
//
// The thing worth pinning down isn't the status codes, it's the blast radius:
// five wrong guesses must shut the studio for everyone including live
// sessions, and must not touch the shop.
//
//   node --test test/studio-auth.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { bundle, makeReq, makeRes, startFakeRedis } from "./helpers.mjs";

const handler = (await import(bundle("api/studio-auth.ts"))).default;
const catalogHandler = (await import(bundle("api/catalog.ts"))).default;
const inventoryHandler = (await import(bundle("api/studio-inventory.ts"))).default;
const session = await import(bundle("api/_lib/studio-session.ts"));
const lock = await import(bundle("api/_lib/studio-lockdown.ts"));
const redis = await import(bundle("api/_lib/redis.ts"));

const fake = await startFakeRedis();
process.env.KV_REST_API_URL = fake.url;
process.env.KV_REST_API_TOKEN = fake.token;
test.after(() => fake.server.close());

const PASSWORD = "correct-horse";
const SECRET = "let-her-back-in";

async function run(opts) {
  const req = makeReq(opts);
  const res = makeRes();
  await handler(req, res);
  return res;
}

const login = password => run({ method: "POST", body: { password } });
const fails = async () => Number((await redis.command(["GET", "studio:auth:fails"])) ?? "0");

// The fake's map is shared across the whole file, so every test starts clean.
test.beforeEach(async () => {
  process.env.PASSWORD = PASSWORD;
  process.env.UNLOCK_SECRET = SECRET;
  await redis.command(["DEL", "studio:lockdown"]);
  await redis.command(["DEL", "studio:auth:fails"]);
});

test("the right password signs in and sets a cookie", async () => {
  const res = await login(PASSWORD);
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["Set-Cookie"]), new RegExp(`^${session.STUDIO_COOKIE_NAME}=`));
});

test("a wrong password is 401 and counts", async () => {
  const res = await login("nope");
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.remaining, 4);
  assert.equal(await fails(), 1);
});

test("the fifth wrong password locks the studio", async () => {
  for (let i = 0; i < 4; i++) assert.equal((await login("nope")).statusCode, 401);
  const res = await login("nope");
  assert.equal(res.statusCode, 423);
  assert.deepEqual(res.body, { error: "ask mohsen to unlock website", lockdown: true });
  assert.equal(await redis.command(["GET", "studio:lockdown"]), "1");
});

test("while locked even the right password is refused", async () => {
  for (let i = 0; i < 5; i++) await login("nope");
  const res = await login(PASSWORD);
  assert.equal(res.statusCode, 423);
  assert.equal(res.headers["Set-Cookie"], undefined);
});

test("a live session dies when the studio locks", async () => {
  const req = makeReq({ cookies: { [session.STUDIO_COOKIE_NAME]: session.issueStudioToken(PASSWORD) } });
  assert.equal(await lock.requireUnlocked(req), true);
  for (let i = 0; i < 5; i++) await login("nope");
  assert.equal(await lock.requireUnlocked(req), false, "a valid cookie must not survive lockdown");
});

// The helper test above checks the function. This checks a call site: a
// forgotten await would typecheck clean and let everyone through.
test("the studio endpoints refuse a signed-in session while locked", async () => {
  const cookies = { [session.STUDIO_COOKIE_NAME]: session.issueStudioToken(PASSWORD) };
  const before = makeRes();
  await inventoryHandler(makeReq({ method: "GET", cookies }), before);
  assert.equal(before.statusCode, 200);
  for (let i = 0; i < 5; i++) await login("nope");
  const after = makeRes();
  await inventoryHandler(makeReq({ method: "GET", cookies }), after);
  assert.equal(after.statusCode, 401);
});

test("GET reports the lockdown, and never unlocked while locked", async () => {
  const cookies = { [session.STUDIO_COOKIE_NAME]: session.issueStudioToken(PASSWORD) };
  const before = await run({ method: "GET", cookies });
  assert.deepEqual(before.body, { unlocked: true, lockdown: false });
  for (let i = 0; i < 5; i++) await login("nope");
  const after = await run({ method: "GET", cookies });
  assert.deepEqual(after.body, { unlocked: false, lockdown: true });
});

test("the shop stays up while the studio is locked", async () => {
  for (let i = 0; i < 5; i++) await login("nope");
  const res = makeRes();
  await catalogHandler(makeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 200, "a stranger guessing passwords must not take the store offline");
});

test("the unlock code lifts the lock and clears the count", async () => {
  for (let i = 0; i < 5; i++) await login("nope");
  const res = await run({ method: "POST", body: { unlock: SECRET } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(await redis.command(["GET", "studio:lockdown"]), null);
  assert.equal(await fails(), 0);
  assert.equal((await login(PASSWORD)).statusCode, 200);
});

test("a wrong unlock code is 401 and leaves the counter alone", async () => {
  await login("nope");
  const res = await run({ method: "POST", body: { unlock: "guess" } });
  assert.equal(res.statusCode, 401);
  assert.equal(await fails(), 1, "guessing the unlock code must not deepen the hole");
});

test("with UNLOCK_SECRET unset, no code works", async () => {
  delete process.env.UNLOCK_SECRET;
  for (let i = 0; i < 5; i++) await login("nope");
  const res = await run({ method: "POST", body: { unlock: "anything" } });
  assert.equal(res.statusCode, 401);
  assert.equal(await redis.command(["GET", "studio:lockdown"]), "1");
});

test("a correct password resets the count, so old typos don't add up", async () => {
  for (let i = 0; i < 4; i++) await login("nope");
  assert.equal((await login(PASSWORD)).statusCode, 200);
  assert.equal(await fails(), 0);
  for (let i = 0; i < 4; i++) assert.equal((await login("nope")).statusCode, 401);
  assert.equal(await redis.command(["GET", "studio:lockdown"]), null);
});

test("the studio stays closed when PASSWORD isn't set", async () => {
  delete process.env.PASSWORD;
  assert.equal((await login("anything")).statusCode, 500);
  assert.equal(await lock.requireUnlocked(makeReq({})), false);
});

test("logout clears the cookie even while locked", async () => {
  for (let i = 0; i < 5; i++) await login("nope");
  const res = await run({ method: "POST", query: { logout: "1" } });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["Set-Cookie"]), /Max-Age=0/);
});
