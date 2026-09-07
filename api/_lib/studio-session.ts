// Shared studio session logic, lifted out of api/studio-auth.ts so other
// endpoints (catalog and inventory writes) can check "is this request
// unlocked" without duplicating the cookie/HMAC logic.
//
// The cookie doesn't hold the password. It holds "<issuedAt>.<hmac>", where the
// HMAC is over that issuedAt keyed by PASSWORD — so only a server holding
// PASSWORD could have minted it, and the timestamp is part of what's signed,
// which is what lets it expire. The old token was an HMAC of a fixed label:
// one value, valid forever, on every device that ever logged in.

import type { VercelRequest } from "@vercel/node";
import { createHmac, timingSafeEqual } from "node:crypto";

export const STUDIO_COOKIE_NAME = "dot_studio_auth";
/** Hard expiry. She works in sittings, not shifts. */
export const STUDIO_SESSION_MS = 8 * 60 * 60 * 1000;

function sign(password: string, issuedAt: number): string {
  return createHmac("sha256", password).update(`dot-studio:${issuedAt}`).digest("hex");
}

export function issueStudioToken(password: string, issuedAt: number = Date.now()): string {
  return `${issuedAt}.${sign(password, issuedAt)}`;
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Signature first, then age — an unsigned token's timestamp means nothing. */
export function verifyStudioToken(token: string, password: string, now: number = Date.now()): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const issuedAt = Number(token.slice(0, dot));
  if (!Number.isSafeInteger(issuedAt)) return false;
  if (!safeEqual(token.slice(dot + 1), sign(password, issuedAt))) return false;
  // A clock skewed into the future would otherwise hand out a longer session.
  if (issuedAt > now + 60_000) return false;
  return now - issuedAt < STUDIO_SESSION_MS;
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

// "Is this request allowed in" lives in ./studio-lockdown.ts, not here: it
// needs Redis, and this file is imported straight into tests that run without
// one.
