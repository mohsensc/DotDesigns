import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRow, isSoldOut } from "./_lib/inventory";

// Starts a Stripe Checkout session for a single piece. The sheet is the only
// source of price and stock — nothing the client sends is trusted for either,
// because a client-supplied amount is the easiest way this kind of endpoint
// gets robbed.

const STRIPE_SESSIONS_URL = "https://api.stripe.com/v1/checkout/sessions";
const DEFAULT_ORIGIN = "https://dotdesigns.art";

function readSlug(req: VercelRequest): string {
  const body = req.body;
  if (body && typeof body === "object" && typeof (body as { slug?: unknown }).slug === "string") {
    return (body as { slug: string }).slug.trim();
  }
  if (typeof body === "string" && body.length > 0) {
    try {
      const parsed = JSON.parse(body) as { slug?: unknown };
      if (typeof parsed.slug === "string") return parsed.slug.trim();
    } catch {
      // not JSON — fall through to empty
    }
  }
  return "";
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

  let row;
  try {
    row = await getRow(slug);
  } catch {
    res.status(502).json({ error: "Couldn't reach the inventory sheet. Please try again." });
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
  if (row.price === null) {
    res.status(409).json({ error: "That piece isn't set up for checkout." });
    return;
  }

  const origin = originOf(req);
  const amountCents = Math.round(row.price * 100);
  // Deterministic within the same minute bucket as the Idempotency-Key below.
  // A random value here would change the request body while the key stayed the
  // same, and Stripe rejects a reused key whose payload differs — so the second
  // click would error instead of collapsing into the first session.
  const bucket = Math.floor(Date.now() / 60_000);
  const clientReferenceId = `${slug}-${bucket}`;

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${origin}/checkout/cancelled`);
  params.set("client_reference_id", clientReferenceId);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "cad");
  params.set("line_items[0][price_data][unit_amount]", String(amountCents));
  params.set("line_items[0][price_data][product_data][name]", row.title || slug);
  params.set("metadata[slug]", slug);

  try {
    const stripeRes = await fetch(STRIPE_SESSIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Two clicks on the same piece within a minute reuse the session
        // instead of opening two. A genuine second purchase of the same
        // one-off piece inside that window is rare enough to accept.
        "Idempotency-Key": `checkout-${slug}-${bucket}`,
      },
      body: params.toString(),
    });

    if (!stripeRes.ok) {
      // Never forward Stripe's response body — it can carry account detail.
      res.status(502).json({ error: "Couldn't start checkout. Please try again." });
      return;
    }

    const json = (await stripeRes.json()) as { url?: string };
    if (!json.url) {
      res.status(502).json({ error: "Couldn't start checkout. Please try again." });
      return;
    }

    res.status(200).json({ url: json.url });
  } catch {
    res.status(502).json({ error: "Couldn't start checkout. Please try again." });
  }
}
