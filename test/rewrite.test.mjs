// The SPA rewrite sends everything to index.html so client-side routing works.
// Everything it does NOT exclude gets index.html — including requests that were
// meant to be real files. When that happens to a .js URL the browser parses
// "<!doctype html>" as JavaScript and throws SyntaxError: Unexpected token '<'.
//
// That's exactly what happened to Vercel's own analytics script: /_vercel/... was
// swallowed by the rewrite and every page load logged an uncaught error. These
// tests pin the exclusions so the next path added to the platform namespace
// doesn't quietly break the same way.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(path.join(repoRoot, "vercel.json"), "utf8"));

const rewrites = config.rewrites ?? [];
const spa = rewrites.find(r => r.destination === "/index.html");

/** Does the SPA rewrite claim this path? */
function rewritten(pathname) {
  assert.ok(spa, "expected a rewrite pointing at /index.html");
  // Vercel anchors `source` against the full path.
  return new RegExp(`^${spa.source}$`).test(pathname);
}

test("the SPA rewrite exists and points at index.html", () => {
  assert.ok(spa, "no SPA rewrite found in vercel.json");
});

test("app routes are rewritten, so client-side routing keeps working", () => {
  assert.equal(rewritten("/"), true);
  assert.equal(rewritten("/shop"), true);
  assert.equal(rewritten("/shop/ash-bowl"), true);
  assert.equal(rewritten("/checkout/success"), true);
  assert.equal(rewritten("/anything-not-built-yet"), true);
});

test("api routes are left alone so the functions actually run", () => {
  assert.equal(rewritten("/api/checkout"), false);
  assert.equal(rewritten("/api/stripe-webhook"), false);
  assert.equal(rewritten("/api/inventory"), false);
});

test("Vercel's own paths are left alone, or their scripts come back as HTML", () => {
  // The regression: this returned index.html with Content-Type text/html, and
  // the browser reported "Unexpected token '<'" on every single page load.
  assert.equal(rewritten("/_vercel/insights/script.js"), false);
  assert.equal(rewritten("/_vercel/speed-insights/script.js"), false);
  assert.equal(rewritten("/_vercel/anything/else"), false);
});
