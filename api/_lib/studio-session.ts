// Shared studio session logic, lifted out of api/studio-auth.ts so other
// endpoints (e.g. inventory writes) can check "is this request unlocked"
// without duplicating the cookie/HMAC logic.
//
// The cookie doesn't hold the password. It holds an HMAC of a fixed label,
// keyed by PASSWORD — a token that only a server holding PASSWORD could have
// produced, so it can't be forged by copying an old cookie value around.

import type { VercelRequest } from "@vercel/node";
import { createHmac, timingSafeEqual } from "node:crypto";

export const STUDIO_COOKIE_NAME = "dot_studio_auth";
export const STUDIO_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function expectedStudioToken(password: string): string {
  return createHmac("sha256", password).update("dot-studio-session").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function readCookie(req: VercelRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

/**
 * True when the request carries a valid studio session cookie. False
 * whenever PASSWORD isn't set — this fails closed, same as studio-auth.
 */
export function isUnlockedRequest(req: VercelRequest): boolean {
  const password = process.env.PASSWORD;
  if (!password) return false;
  const cookie = readCookie(req, STUDIO_COOKIE_NAME);
  return !!cookie && safeEqual(cookie, expectedStudioToken(password));
}
