import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  STUDIO_COOKIE_MAX_AGE,
  STUDIO_COOKIE_NAME,
  expectedStudioToken,
  readCookie,
  safeEqual,
} from "./_lib/studio-session";

// Single security control for the studio: one password, in the Vercel env var
// PASSWORD, never in this codebase. If it isn't set, this fails closed — no
// path in here authenticates anyone without it.
//
// The HMAC/cookie mechanics live in api/_lib/studio-session.ts so other
// endpoints can check "is this request unlocked" too.

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
    const cookie = readCookie(req, STUDIO_COOKIE_NAME);
    const unlocked = !!cookie && safeEqual(cookie, expectedStudioToken(password));
    res.status(200).json({ unlocked });
    return;
  }

  if (req.method === "POST") {
    const submitted = readPassword(req);
    if (!submitted || !safeEqual(submitted, password)) {
      res.status(401).json({ error: "Wrong password." });
      return;
    }
    const token = expectedStudioToken(password);
    res.setHeader(
      "Set-Cookie",
      `${STUDIO_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${STUDIO_COOKIE_MAX_AGE}`,
    );
    res.status(200).json({ unlocked: true });
    return;
  }

  res.setHeader("Allow", "GET, POST");
  res.status(405).json({ error: "method not allowed" });
}
