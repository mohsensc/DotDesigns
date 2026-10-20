import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { readCatalog } from "./_lib/catalog";
import { HOLD_MS, getRow, holdPiece, isConfigured, isSoldOut, releaseHold } from "./_lib/inventory";

// Starts a Stripe Checkout session for a single piece. The inventory store is
// the only source of price and stock — nothing the client sends is trusted,
// because a client-supplied amount is the easiest way this kind of endpoint
// gets robbed.

const STRIPE_SESSIONS_URL = "https://api.stripe.com/v1/checkout/sessions";
const DEFAULT_ORIGIN = "https://dotdesigns.art";

const HOLD_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MIN_AMOUNT_CENTS = 50;

function readBody(req: VercelRequest): { slug?: unknown; holdId?: unknown } {
  const body = req.body;
  if (body && typeof body === "object") return body as { slug?: unknown; holdId?: unknown };
  if (typeof body === "string" && body.length > 0) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object") return parsed as { slug?: unknown; holdId?: unknown };
    } catch {
      // not JSON — fall through to empty
    }
  }
  return {};
}

function readSlug(req: VercelRequest): string {
  const { slug } = readBody(req);
  return typeof slug === "string" ? slug.trim() : "";
}

function readHoldId(req: VercelRequest): string {
  const { holdId } = readBody(req);
  return typeof holdId === "string" && HOLD_ID_PATTERN.test(holdId) ? holdId : randomUUID();
}

/**
 * Where Stripe sends the buyer back to.
 *
 * The forwarded host is attacker-controlled — anyone can POST here with their
 * own X-Forwarded-Host — and it ends up in success_url alongside the real
 * CHECKOUT_SESSION_ID. Unchecked, that redirects a paying customer, session id
 * in hand, to a domain of the attacker's choosing. So the header is only
 * honoured when it's somewhere we actually live; everything else falls back to
 * the canonical origin. Preview deploys still work, they're all *.vercel.app.
 */
function isOurHost(host: string): boolean {
  const bare = host.split(":")[0].toLowerCase();
  return bare === "dotdesigns.art" || bare === "www.dotdesigns.art" || bare.endsWith(".vercel.app");
}

function originOf(req: VercelRequest): string {
  const proto = req.headers["x-forwarded-proto"];
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const p = Array.isArray(proto) ? proto[0] : proto;
  const h = Array.isArray(host) ? host[0] : host;
  if (p && h && isOurHost(h)) return `${p}://${h}`;
  return DEFAULT_ORIGIN;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const secretKey = process.env.STRIPE_KEY;
  if (!secretKey) {
    res.status(500).json({ error: "not configured" });
    return;
  }

  const slug = readSlug(req);
  if (!slug) {
    res.status(400).json({ error: "A piece is required." });
    return;
  }

  if (!isConfigured()) {
    res.status(503).json({ error: "The stock ledger isn't available right now." });
    return;
  }

  let row;
  let listed;
  try {
    [row, listed] = await Promise.all([
      getRow(slug),
      readCatalog().then(catalog => catalog.pieces.find(piece => piece.slug === slug)),
    ]);
  } catch {
    res.status(502).json({ error: "Couldn't reach the inventory. Please try again." });
    return;
  }

  if (!row) {
    res.status(404).json({ error: "Piece not found." });
    return;
  }
  if (isSoldOut(row)) {
    res.status(409).json({ error: "That piece is sold out." });
    return;
  }
  if (listed && listed.status !== "available") {
    res.status(409).json({ error: "That piece isn't available right now." });
    return;
  }
  const amountCents = row.price === null ? 0 : Math.round(row.price * 100);
  if (row.price === null || amountCents < MIN_AMOUNT_CENTS) {
    res.status(409).json({ error: "That piece isn't set up for checkout." });
    return;
  }

  const holdId = readHoldId(req);
  let hold;
  try {
    hold = await holdPiece(slug, holdId);
  } catch {
    res.status(502).json({ error: "Couldn't reach the inventory. Please try again." });
    return;
  }
  if (hold === "soldOut") {
    res.status(409).json({ error: "That piece is sold out." });
    return;
  }
  if (hold === "busy") {
    res.status(409).json({ error: "Someone is checking out this piece right now. Try again in a few minutes." });
    return;
  }

  const origin = originOf(req);

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${origin}/checkout/cancelled`);
  params.set("client_reference_id", holdId);
  params.set("expires_at", String(Math.floor((Date.now() + HOLD_MS - 60_000) / 1000)));
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "cad");
  params.set("line_items[0][price_data][unit_amount]", String(amountCents));
  params.set("line_items[0][price_data][product_data][name]", row.title || slug);
  params.set("metadata[slug]", slug);
  params.set("metadata[holdId]", holdId);

  async function fail() {
    await releaseHold(slug, holdId).catch(() => undefined);
    res.status(502).json({ error: "Couldn't start checkout. Please try again." });
  }

  try {
    const stripeRes = await fetch(STRIPE_SESSIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!stripeRes.ok) {
      await fail();
      return;
    }

    const json = (await stripeRes.json()) as { url?: string };
    if (!json.url) {
      await fail();
      return;
    }

    res.status(200).json({ url: json.url });
  } catch {
    await fail();
  }
}
