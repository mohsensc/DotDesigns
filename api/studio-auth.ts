import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  STUDIO_COOKIE_NAME,
  issueStudioToken,
  readCookie,
  safeEqual,
  verifyStudioToken,
} from "./_lib/studio-session";

// Single security control for the studio: one password, in the Vercel env var
// PASSWORD, never in this codebase. If it isn't set, this fails closed — no
// path in here authenticates anyone without it.
//
//   GET             -> is this browser unlocked?
//   POST {password} -> unlock, set the cookie
//   POST ?logout=1  -> clear it
//
// The cookie has no Max-Age on purpose: closing Safari should forget the
// studio, the same way closing a bank tab does. The token expires eight hours
// after login regardless.
//
// The HMAC mechanics live in api/_lib/studio-session.ts so other endpoints can
// check "is this request unlocked" too.

const CLEARED = `${STUDIO_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

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

function wantsLogout(req: VercelRequest): boolean {
  if (req.method === "DELETE") return true;
  const raw = req.query.logout;
  return !!(Array.isArray(raw) ? raw[0] : raw);
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (wantsLogout(req)) {
    res.setHeader("Set-Cookie", CLEARED);
    res.status(200).json({ unlocked: false });
    return;
  }

  const password = process.env.PASSWORD;
  if (!password) {
    // Never authenticate anyone when the site isn't configured yet.
    res.status(500).json({ error: "not configured" });
    return;
  }

  if (req.method === "GET") {
    const cookie = readCookie(req, STUDIO_COOKIE_NAME);
    const unlocked = !!cookie && verifyStudioToken(cookie, password);
    res.status(200).json({ unlocked });
    return;
  }

  if (req.method === "POST") {
    const submitted = readPassword(req);
    if (!submitted || !safeEqual(submitted, password)) {
      res.status(401).json({ error: "Wrong password." });
      return;
    }
    res.setHeader(
      "Set-Cookie",
      `${STUDIO_COOKIE_NAME}=${issueStudioToken(password)}; HttpOnly; Secure; SameSite=Lax; Path=/`,
    );
    res.status(200).json({ unlocked: true });
    return;
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  res.status(405).json({ error: "method not allowed" });
}
