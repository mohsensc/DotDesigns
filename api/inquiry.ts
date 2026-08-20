import type { VercelRequest, VercelResponse } from "@vercel/node";

// Vercel function behind /api/inquiry. Turns a submission from the shop
// (piece enquiries and the Special Request form) into a real email, sent
// through the Resend REST API with plain fetch — no SDK, no dependency.
//
// This exists because the old mailto: link silently did nothing on webmail
// with no mail client registered: the lead vanished and nobody found out.
// Every failure path here reports back to the caller instead of eating it.

const MAX_MESSAGE_LENGTH = 5000;
const RESEND_URL = "https://api.resend.com/emails";

type InquiryKind = "piece" | "request";

type InquiryBody = {
  kind?: unknown;
  name?: unknown;
  email?: unknown;
  message?: unknown;
  pieceTitle?: unknown;
  pieceSlug?: unknown;
  space?: unknown;
  dimensions?: unknown;
  timeline?: unknown;
  priceBand?: unknown;
  website?: unknown;
};

function isEmailish(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseBody(req: VercelRequest): InquiryBody {
  const body = req.body;
  if (body && typeof body === "object") return body as InquiryBody;
  if (typeof body === "string" && body.length > 0) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object") return parsed as InquiryBody;
    } catch {
      // not JSON — fall through to empty
    }
  }
  return {};
}

function buildEmailText(fields: {
  kind: InquiryKind;
  name: string;
  email: string;
  message: string;
  pieceTitle: string;
  pieceSlug: string;
  space: string;
  dimensions: string;
  timeline: string;
  priceBand: string;
}): string {
  const lines = [`Name: ${fields.name}`, `Email: ${fields.email}`];
  if (fields.pieceTitle) lines.push(`Piece: ${fields.pieceTitle}${fields.pieceSlug ? ` (${fields.pieceSlug})` : ""}`);
  lines.push("", "Message:", fields.message);
  if (fields.space) lines.push("", `Space / room: ${fields.space}`);
  if (fields.dimensions) lines.push(`Rough dimensions: ${fields.dimensions}`);
  if (fields.timeline) lines.push(`Timeline: ${fields.timeline}`);
  if (fields.priceBand) lines.push(`Budget range: ${fields.priceBand}`);
  return lines.join("\n");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.INQUIRY_TO;
  const from = process.env.INQUIRY_FROM;
  if (!apiKey || !to || !from) {
    // Fail closed — never send from a half-configured deploy.
    res.status(500).json({ error: "not configured" });
    return;
  }

  const body = parseBody(req);

  // Honeypot: a bot filled in a field real visitors never see. Pretend it
  // worked so it never learns it was caught, and send nothing.
  if (asString(body.website).trim().length > 0) {
    res.status(200).json({ ok: true });
    return;
  }

  const kind: InquiryKind = body.kind === "piece" ? "piece" : "request";
  const name = asString(body.name).trim();
  const email = asString(body.email).trim();
  const message = asString(body.message).trim();
  const pieceTitle = asString(body.pieceTitle).trim();
  const pieceSlug = asString(body.pieceSlug).trim();
  const space = asString(body.space).trim();
  const dimensions = asString(body.dimensions).trim();
  const timeline = asString(body.timeline).trim();
  const priceBand = asString(body.priceBand).trim();

  if (!name) {
    res.status(400).json({ error: "Name is required." });
    return;
  }
  if (!email || !isEmailish(email)) {
    res.status(400).json({ error: "A working email is required." });
    return;
  }
  if (!message) {
    res.status(400).json({ error: "Message is required." });
    return;
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).` });
    return;
  }

  const subject =
    kind === "piece" && pieceTitle ? `Enquiry — ${pieceTitle}` : `Special request — ${name}`;

  const text = buildEmailText({
    kind,
    name,
    email,
    message,
    pieceTitle,
    pieceSlug,
    space,
    dimensions,
    timeline,
    priceBand,
  });

  try {
    const resendRes = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        text,
        reply_to: email,
      }),
    });

    if (!resendRes.ok) {
      // Never leak Resend's response body — it can carry account details.
      res.status(502).json({ error: "Couldn't send the message. Please try again." });
      return;
    }

    res.status(200).json({ ok: true });
  } catch {
    res.status(502).json({ error: "Couldn't send the message. Please try again." });
  }
}
