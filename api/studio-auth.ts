import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearFailures, isLockedDown, liftLockdown, noteWrongPassword } from "./_lib/studio-lockdown";
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
//   GET             -> is this browser unlocked? is the studio locked down?
//   POST {password} -> unlock, set the cookie
//   POST {unlock}   -> lift a lockdown, with UNLOCK_SECRET
//   POST ?logout=1  -> clear it
//
// Five wrong passwords lock the studio for everyone until someone POSTs the
// unlock code. Only the studio — the shop keeps serving.
//
// The cookie has no Max-Age on purpose: closing Safari should forget the
// studio, the same way closing a bank tab does. The token expires eight hours
// after login regardless.
//
// The HMAC mechanics live in api/_lib/studio-session.ts so other endpoints can
// check "is this request unlocked" too.

const CLEARED = `${STUDIO_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

function bodyField(req: VercelRequest, field: "password" | "unlock"): string {
  let body: unknown = req.body;
  if (typeof body === "string" && body.length > 0) {
    try {
      body = JSON.parse(body);
    } catch {
      return "";
    }
  }
  if (body && typeof body === "object") {
    const value = (body as Record<string, unknown>)[field];
    if (typeof value === "string") return value;
  }
  return "";
}

function wantsLogout(req: VercelRequest): boolean {
  if (req.method === "DELETE") return true;
  const raw = req.query.logout;
  return !!(Array.isArray(raw) ? raw[0] : raw);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (wantsLogout(req)) {
    res.setHeader("Set-Cookie", CLEARED);
    res.status(200).json({ unlocked: false });
    return;
  }

  // Before the lockdown gate, or the lock could never be lifted. This is the
  // one thing a locked studio still answers.
  const unlockCode = req.method === "POST" ? bodyField(req, "unlock") : "";
  if (unlockCode) {
    const secret = process.env.UNLOCK_SECRET;
    // A wrong code doesn't count against the password counter — it isn't a
    // password guess, and guessing this one shouldn't deepen the hole.
    if (!secret || !safeEqual(unlockCode, secret)) {
      res.status(401).json({ error: "Wrong code." });
      return;
    }
    try {
      await liftLockdown();
    } catch {
      // Don't let "Redis is down" come back as "wrong code" — that sends the
      // one person who can fix this looking for a typo.
      res.status(503).json({ error: "Couldn't reach storage. Try again." });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  const password = process.env.PASSWORD;
  if (!password) {
    // Never authenticate anyone when the site isn't configured yet.
    res.status(500).json({ error: "not configured" });
    return;
  }

  const lockdown = await isLockedDown();

  if (req.method === "GET") {
    const cookie = readCookie(req, STUDIO_COOKIE_NAME);
    const unlocked = !lockdown && !!cookie && verifyStudioToken(cookie, password);
    res.status(200).json({ unlocked, lockdown });
    return;
  }

  if (req.method === "POST") {
    // While locked, the right password gets the same answer as a wrong one.
    if (lockdown) {
      res.status(423).json({ error: "ask mohsen to unlock website", lockdown: true });
      return;
    }
    const submitted = bodyField(req, "password");
    if (!submitted || !safeEqual(submitted, password)) {
      const { remaining, locked } = await noteWrongPassword();
      if (locked) {
        res.status(423).json({ error: "ask mohsen to unlock website", lockdown: true });
        return;
      }
      res.status(401).json({ error: "Wrong password.", remaining });
      return;
    }
    await clearFailures();
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
