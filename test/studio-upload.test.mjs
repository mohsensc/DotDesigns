// Tests for api/studio-upload.ts — the door that hands out Blob write tokens.
// The browser's blob client throws one generic "Failed to retrieve the client
// token" for any non-200 here, so the status codes are the only signal the
// studio gets about why an upload died.
//
//   node --test test/studio-upload.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { bundle, makeReq, makeRes } from "./helpers.mjs";

const handler = (await import(bundle("api/studio-upload.ts"))).default;
const session = await import(bundle("api/_lib/studio-session.ts"));

const PASSWORD = "correct-horse";
// Any string of this shape works: the client token is an HMAC minted locally,
// nothing talks to Vercel until the browser actually PUTs the file.
const TOKEN = "vercel_blob_rw_teststore_abcdefghijklmnop";

function cookie() {
  return { [session.STUDIO_COOKIE_NAME]: session.issueStudioToken(PASSWORD) };
}

function handshake(pathname) {
  return { type: "blob.generate-client-token", payload: { pathname, clientPayload: null, multipart: false } };
}

async function run({ body, cookies, env }) {
  delete process.env.PASSWORD;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  Object.assign(process.env, env);
  const req = makeReq({ method: "POST", body, cookies, headers: { "content-type": "application/json" } });
  const res = makeRes();
  await handler(req, res);
  return res;
}

test("no session is a 401, even when the blob token is missing", async () => {
  const res = await run({ body: handshake("pieces/p1/a.jpg"), env: { PASSWORD } });
  assert.equal(res.statusCode, 401);
});

test("no PASSWORD fails closed as 401", async () => {
  const res = await run({ body: handshake("pieces/p1/a.jpg"), cookies: cookie(), env: { BLOB_READ_WRITE_TOKEN: TOKEN } });
  assert.equal(res.statusCode, 401);
});

test("missing blob token names the env var in the error", async () => {
  const res = await run({ body: handshake("pieces/p1/a.jpg"), cookies: cookie(), env: { PASSWORD } });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /BLOB_READ_WRITE_TOKEN/);
});

test("a path outside pieces/ is refused", async () => {
  const res = await run({
    body: handshake("../etc/passwd"),
    cookies: cookie(),
    env: { PASSWORD, BLOB_READ_WRITE_TOKEN: TOKEN },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /pieces\//);
});

test("signed in with a token mints a client token", async () => {
  const res = await run({
    body: handshake("pieces/p1/a.jpg"),
    cookies: cookie(),
    env: { PASSWORD, BLOB_READ_WRITE_TOKEN: TOKEN },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.type, "blob.generate-client-token");
  assert.match(res.body.clientToken, /^vercel_blob_client_/);
});
