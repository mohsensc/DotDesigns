// The catalog rules and the studio token, both pure enough to test without
// Redis. Node strips the types off the .ts imports.
//
// What's actually being pinned here: a slug can't collide or carry characters
// that need escaping in a URL, a piece can't bring fields we didn't ask for
// along for the ride, and a session token can't outlive its eight hours or
// survive a changed password.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError,
  applyOrder,
  publicView,
  removePiece,
  sanitisePiece,
  slugify,
  upsertPiece,
} from "../api/_lib/catalog-shape.ts";
import { STUDIO_SESSION_MS, issueStudioToken, verifyStudioToken } from "../api/_lib/studio-session.ts";

const base = { id: "p-1", title: "Ash Bowl", price: 500, media: [] };
const catalogOf = (...pieces) => ({ version: 1, pieces, updatedAt: "2026-01-01T00:00:00.000Z" });

test("slugs are lowercase, ascii, and hyphenated", () => {
  assert.equal(slugify("The Wave Wall"), "the-wave-wall");
  assert.equal(slugify("  Héllo, Wörld!  "), "hello-world");
  assert.equal(slugify("Bowl #3 (2026)"), "bowl-3-2026");
  assert.equal(slugify("///"), "");
});

test("a piece with no usable slug is refused rather than given one", () => {
  assert.throws(() => sanitisePiece({ ...base, title: "!!!" }), ValidationError);
});

test("the slug follows the title when she doesn't set one", () => {
  assert.equal(sanitisePiece(base).slug, "ash-bowl");
});

test("unknown fields don't survive the trip", () => {
  const piece = sanitisePiece({ ...base, isAdmin: true, status: "nonsense" });
  assert.equal("isAdmin" in piece, false);
  assert.equal(piece.status, "draft");
});

test("two pieces can't share a slug", () => {
  const catalog = catalogOf(sanitisePiece(base));
  const other = sanitisePiece({ ...base, id: "p-2" });
  assert.throws(() => upsertPiece(catalog, other), ValidationError);
  // Same piece saving again is not a collision.
  assert.doesNotThrow(() => upsertPiece(catalog, sanitisePiece(base)));
});

test("blank price means not for sale, a bad one is refused", () => {
  assert.equal(sanitisePiece({ ...base, price: "" }).price, null);
  assert.equal(sanitisePiece({ ...base, price: undefined }).price, null);
  assert.throws(() => sanitisePiece({ ...base, price: "1200 (was 1500)" }), ValidationError);
  assert.throws(() => sanitisePiece({ ...base, price: -5 }), ValidationError);
});

test("media has to live on this site", () => {
  const ok = sanitisePiece({
    ...base,
    media: [
      { id: "m1", kind: "image", src: "/world/atelier.webp", caption: " Gold " },
      { id: "m2", kind: "video", src: "https://abc123.public.blob.vercel-storage.com/pieces/p-1/clip.mp4" },
    ],
  });
  assert.equal(ok.media.length, 2);
  assert.equal(ok.media[0].caption, "Gold");
  assert.throws(
    () => sanitisePiece({ ...base, media: [{ id: "m1", kind: "image", src: "https://evil.example/x.jpg" }] }),
    ValidationError,
  );
});

test("the cover has to be one of the piece's own photos", () => {
  const piece = sanitisePiece({
    ...base,
    coverId: "m-nope",
    media: [{ id: "m1", kind: "image", src: "/world/atelier.webp" }],
  });
  assert.equal(piece.coverId, undefined);
});

test("reordering renumbers from one and keeps everyone", () => {
  const a = sanitisePiece({ ...base, id: "p-a", title: "A", order: 1 });
  const b = sanitisePiece({ ...base, id: "p-b", title: "B", order: 2 });
  const c = sanitisePiece({ ...base, id: "p-c", title: "C", order: 3 });
  const next = applyOrder(catalogOf(a, b, c), ["p-c", "p-a"]);
  assert.deepEqual(next.pieces.map(p => p.id), ["p-c", "p-a", "p-b"]);
  assert.deepEqual(next.pieces.map(p => p.order), [1, 2, 3]);
});

test("the public view drops drafts and sorts by order", () => {
  const a = sanitisePiece({ ...base, id: "p-a", title: "A", status: "available", order: 2 });
  const b = sanitisePiece({ ...base, id: "p-b", title: "B", status: "sold", order: 1 });
  const draft = sanitisePiece({ ...base, id: "p-d", title: "D", status: "draft", order: 0 });
  const view = publicView(catalogOf(a, b, draft));
  assert.deepEqual(view.pieces.map(p => p.id), ["p-b", "p-a"]);
});

test("deleting takes the piece and nothing else", () => {
  const a = sanitisePiece({ ...base, id: "p-a", title: "A" });
  const b = sanitisePiece({ ...base, id: "p-b", title: "B" });
  assert.deepEqual(removePiece(catalogOf(a, b), "p-a").pieces.map(p => p.id), ["p-b"]);
});

test("every write stamps a new updatedAt, which is what the 409 compares", () => {
  const catalog = catalogOf();
  const next = upsertPiece(catalog, sanitisePiece(base));
  assert.notEqual(next.updatedAt, catalog.updatedAt);
});

// ---- the studio token ------------------------------------------------------

test("a token is valid for its password and nothing else", () => {
  const token = issueStudioToken("hunter2");
  assert.equal(verifyStudioToken(token, "hunter2"), true);
  assert.equal(verifyStudioToken(token, "hunter3"), false);
});

test("a token expires eight hours after it was issued", () => {
  const issuedAt = Date.now() - STUDIO_SESSION_MS + 1000;
  assert.equal(verifyStudioToken(issueStudioToken("pw", issuedAt), "pw"), true);
  const old = Date.now() - STUDIO_SESSION_MS - 1000;
  assert.equal(verifyStudioToken(issueStudioToken("pw", old), "pw"), false);
});

test("a forged or reshaped token is refused", () => {
  const issuedAt = Date.now();
  const token = issueStudioToken("pw", issuedAt);
  // Moving the timestamp forward doesn't move the signature with it.
  assert.equal(verifyStudioToken(`${issuedAt + 1}.${token.split(".")[1]}`, "pw"), false);
  assert.equal(verifyStudioToken("deadbeef", "pw"), false);
  assert.equal(verifyStudioToken("", "pw"), false);
  // A clock set forward would otherwise buy a longer session.
  assert.equal(verifyStudioToken(issueStudioToken("pw", Date.now() + 600_000), "pw"), false);
});
