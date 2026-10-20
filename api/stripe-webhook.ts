import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac, timingSafeEqual } from "node:crypto";
import { recordSale, releaseHold } from "./_lib/inventory";

// Stripe calls this when a checkout finishes. Verifying the signature is the
// whole security model here — an unverified POST to this URL is a free way
// to mark stock sold, so nothing runs before that check passes.

export const config = { api: { bodyParser: false } };

const MAX_AGE_SECONDS = 5 * 60;

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function parseSignatureHeader(header: string): { t: string; v1s: string[] } | null {
  let t = "";
  const v1s: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    // Stripe sends more than one v1 during a signing-secret rotation
    // (old secret and new secret each sign a copy) — accept any match.
    if (key === "t") t = value;
    else if (key === "v1") v1s.push(value);
  }
  if (!t || v1s.length === 0) return null;
  return { t, v1s };
}

function verifySignature(rawBody: Buffer, header: string, secret: string): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;

  const timestamp = Number(parsed.t);
  if (!Number.isFinite(timestamp)) return false;
  // One-directional, matching Stripe's own tolerance check: only reject
  // stale timestamps, not ones slightly ahead from small clock skew.
  const ageSeconds = Date.now() / 1000 - timestamp;
  if (ageSeconds > MAX_AGE_SECONDS) return false;

  // Concatenate as bytes, not via template-literal string interpolation —
  // interpolating a Buffer coerces it through toString("utf8"), which is
  // silently lossy for any payload byte that isn't valid UTF-8.
  const signedPayload = Buffer.concat([Buffer.from(`${parsed.t}.`), rawBody]);
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  const expectedBuf = Buffer.from(expected);

  return parsed.v1s.some((v1) => {
    const gotBuf = Buffer.from(v1);
    if (expectedBuf.length !== gotBuf.length) return false;
    return timingSafeEqual(expectedBuf, gotBuf);
  });
}

type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: { id?: string; payment_status?: string; metadata?: { slug?: string; holdId?: string } } };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK;
  if (!webhookSecret) {
    res.status(500).json({ error: "not configured" });
    return;
  }

  const signatureHeader = req.headers["stripe-signature"];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!signature) {
    res.status(400).json({ error: "missing signature" });
    return;
  }

  const rawBody = await readRawBody(req);

  if (!verifySignature(rawBody, signature, webhookSecret)) {
    res.status(400).json({ error: "invalid signature" });
    return;
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody.toString("utf8")) as StripeEvent;
  } catch {
    res.status(400).json({ error: "invalid payload" });
    return;
  }

  if (event.type === "checkout.session.expired") {
    const expiredSlug = event.data?.object?.metadata?.slug;
    const expiredHold = event.data?.object?.metadata?.holdId;
    if (expiredSlug && expiredHold) {
      try {
        await releaseHold(expiredSlug, expiredHold);
      } catch (err) {
        console.error(`stripe-webhook: failed to release hold for slug "${expiredSlug}"`, err);
        res.status(500).json({ error: "could not release stock" });
        return;
      }
    }
    res.status(200).json({ ok: true });
    return;
  }

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    res.status(200).json({ ok: true });
    return;
  }

  // completed does NOT mean paid. A method that settles asynchronously fires
  // completed with payment_status "unpaid" and confirms later, so acting on
  // the event alone would mark a piece sold out before any money arrived — and
  // if the payment then failed, nothing would put the stock back. The
  // async_payment_succeeded event above is what closes that loop.
  const paymentStatus = event.data?.object?.payment_status;
  if (paymentStatus !== "paid" && paymentStatus !== "no_payment_required") {
    res.status(200).json({ ok: true });
    return;
  }

  const slug = event.data?.object?.metadata?.slug;
  const holdId = event.data?.object?.metadata?.holdId ?? "";
  const saleId = event.data?.object?.id ?? event.id ?? "";

  if (slug) {
    try {
      const sale = await recordSale(slug, saleId, holdId);
      if (sale === "oversold") {
        console.error(
          `stripe-webhook: paid for slug "${slug}" (session ${saleId}) but none was left in stock. Refund this buyer.`,
        );
      }
    } catch (err) {
      console.error(`stripe-webhook: failed to record sale for slug "${slug}"`, err);
      res.status(500).json({ error: "could not update stock" });
      return;
    }
  }

  res.status(200).json({ ok: true });
}
