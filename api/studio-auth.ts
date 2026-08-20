import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac, timingSafeEqual } from "node:crypto";

// Single security control for the studio: one password, in the Vercel env var
// PASSWORD, never in this codebase. If it isn't set, this fails closed — no
// path in here authenticates anyone without it.
//
// The cookie doesn't hold the password. It holds an HMAC of a fixed label,
// keyed by PASSWORD — a token that only a server holding PASSWORD could have
// produced, so it can't be forged by copying an old cookie value around.
const COOKIE_NAME = "dot_studio_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function expectedToken(password: string): string {
  return createHmac("sha256", password).update("dot-studio-session").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function readCookie(req: VercelRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

function readPassword(req: VercelRequest): string {
  const body = req.body;
  if (body && typeof body === "object" && typeof (body as { password?: unknown }).password === "string") {
    return (body as { password: string }).password;
  }
  if (typeof body === "string" && body.length > 0) {
    try {
      const parsed = JSON.parse(body) as { password?: unknown };
      if (typeof parsed.password === "string") return parsed.password;
    } catch {
      // not JSON — fall through to empty
    }
  }
  return "";
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  const password = process.env.PASSWORD;
  if (!password) {
    // Never authenticate anyone when the site isn't configured yet.
    res.status(500).json({ error: "not configured" });
    return;
  }

  if (req.method === "GET") {
    const cookie = readCookie(req, COOKIE_NAME);
    const unlocked = !!cookie && safeEqual(cookie, expectedToken(password));
    res.status(200).json({ unlocked });
    return;
  }

  if (req.method === "POST") {
    const submitted = readPassword(req);
    if (!submitted || !safeEqual(submitted, password)) {
      res.status(401).json({ error: "Wrong password." });
      return;
    }
    const token = expectedToken(password);
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`,
    );
    res.status(200).json({ unlocked: true });
    return;
  }

  res.setHeader("Allow", "GET, POST");
  res.status(405).json({ error: "method not allowed" });
}
