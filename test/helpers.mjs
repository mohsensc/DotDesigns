// Shared scaffolding for endpoint tests: bundling TS handlers, faking
// req/res, faking the raw-body stream the webhook reads, building a real
// Stripe-Signature header, and standing in for api.stripe.com.
//
// Nothing here talks to a real network. startFakeRedis is re-exported so a
// test that needs both a fake Redis and a fake Stripe needs one import.

import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export { startFakeRedis } from "./fake-redis.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const esbuild = path.join(repoRoot, "node_modules/.bin/esbuild");

// Bundles live under node_modules so bare imports left external still resolve.
// Bundling @vercel/blob all the way in breaks: its jose dependency does a
// dynamic require that esbuild can't express in ESM output.
const cacheDir = path.join(repoRoot, "node_modules/.cache");
mkdirSync(cacheDir, { recursive: true });
const work = mkdtempSync(path.join(cacheDir, "dot-tests-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));

const bundleCache = new Map();

/**
 * Bundles a repo-relative .ts file (e.g. "api/checkout.ts") into a temp .mjs
 * via esbuild and returns its path, so it can be `import()`ed from a plain
 * node test. Cached per input path — call it again for free.
 */
export function bundle(tsRelPath) {
  if (bundleCache.has(tsRelPath)) return bundleCache.get(tsRelPath);
  const outfile = path.join(work, `${tsRelPath.replace(/[\\/]/g, "_")}.mjs`);
  execFileSync(
    esbuild,
    [path.join(repoRoot, tsRelPath), "--bundle", "--platform=node", "--format=esm", "--packages=external", `--outfile=${outfile}`],
    { stdio: "pipe" },
  );
  bundleCache.set(tsRelPath, outfile);
  return outfile;
}

/**
 * A fake VercelRequest. Body may be a plain object or a JSON string — the
 * handlers accept both. Cookies is a shorthand for a Cookie header, merged
 * ahead of any Cookie already in headers.
 */
export function makeReq({ method = "GET", body, query = {}, headers = {}, cookies } = {}) {
  const h = { ...headers };
  if (cookies) {
    const cookieStr =
      typeof cookies === "string"
        ? cookies
        : Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join("; ");
    h.cookie = cookieStr;
  }
  return { method, body, query, headers: h };
}

/**
 * A fake VercelResponse. Records status/json/headers and exposes them as
 * plain fields after the handler runs. res.status() returns res so
 * `res.status(n).json(obj)` chains the way the real handlers use it.
 */
export function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    ended: false,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(obj) {
      res.body = obj;
      return res;
    },
    setHeader(key, value) {
      res.headers[key] = value;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
  };
  return res;
}

/**
 * A fake VercelRequest for handlers that read the raw body themselves
 * (bodyParser: false), like the Stripe webhook. Async-iterable, yielding the
 * raw body as Buffer chunks so a signature check sees the exact bytes.
 */
export function makeStreamReq({ rawBody, headers = {}, method = "POST" } = {}) {
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody ?? "");
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      yield buf;
    },
  };
}

/**
 * Builds a Stripe-Signature header value the way Stripe itself does: HMAC-
 * SHA256 of "${timestamp}.${payload}" keyed by secret, hex, formatted as
 * "t=<ts>,v1=<sig>". Pass timestamp explicitly to test staleness.
 */
export function stripeSignature({ payload, secret, timestamp = Math.floor(Date.now() / 1000) }) {
  const signedPayload = `${timestamp}.${payload}`;
  const sig = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

/**
 * A local http server standing in for api.stripe.com. `calls` records every
 * request it received, with the form body parsed into an object (checkout.ts
 * always sends application/x-www-form-urlencoded). Responds 200 with a fake
 * checkout URL by default; pass `respond(parsedBody)` to return
 * { status, body } instead, e.g. to simulate a Stripe error.
 */
export function startFakeStripe({ respond } = {}) {
  const calls = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const parsed = Object.fromEntries(new URLSearchParams(raw));
        calls.push({ method: req.method, url: req.url, headers: req.headers, body: parsed, raw });
        const { status, body } = respond
          ? respond(parsed)
          : { status: 200, body: { url: "https://checkout.stripe.com/fake" } };
        res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
      });
    });
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${server.address().port}`, calls }),
    );
  });
}

/**
 * Swaps globalThis.fetch for a stub that routes requests by URL prefix to
 * local fake servers, e.g. stubFetch({ "https://api.stripe.com": fakeStripe.url }).
 * Returns a restore function that puts the original fetch back.
 */
export function stubFetch(routes) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    for (const [prefix, target] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        const rewritten = target + url.slice(prefix.length);
        return original(rewritten, init);
      }
    }
    throw new Error(`stubFetch: no route for ${url}`);
  };
  return () => {
    globalThis.fetch = original;
  };
}
