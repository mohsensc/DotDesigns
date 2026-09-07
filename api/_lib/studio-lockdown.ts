// The wrong-password lockdown, and the session check that honours it.
//
// Split out of studio-session.ts because that file is pure — no Redis, no
// network — and test/catalog.test.mjs imports it directly to check the token
// maths. This half needs Redis, so it lives on its own.

import type { VercelRequest } from "@vercel/node";
import { command, isConfigured } from "./redis";
import { STUDIO_COOKIE_NAME, readCookie, verifyStudioToken } from "./studio-session";

/** Keys for the wrong-password lockdown. See LOCKDOWN below. */
const FAILS_KEY = "studio:auth:fails";
const LOCKDOWN_KEY = "studio:lockdown";
export const MAX_FAILS = 5;
/** Wrong guesses only add up inside this window. Typos a week apart don't. */
const FAILS_WINDOW_S = 60 * 60;

// LOCKDOWN. Five wrong passwords and the studio shuts, for everyone, until
// someone POSTs the unlock code. The counter is global rather than per-IP:
// there is one person who knows this password, so a stranger grinding away
// from anywhere is the case worth stopping, and rotating IPs is free.
//
// The shop never consults any of this. A stranger typing five wrong passwords
// must not be able to take the store offline.
//
// With Redis unconfigured or unreachable we treat the studio as not locked.
// A Redis blip locking her out of her own site is the worse failure, and the
// password check is untouched either way.

export async function isLockedDown(): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    return (await command<string | null>(["GET", LOCKDOWN_KEY])) === "1";
  } catch {
    return false;
  }
}

/**
 * Counts one wrong password and locks the studio on the fifth.
 * Returns how many guesses are left, and whether that guess was the last one.
 *
 * INCR, not read-then-write: twenty guesses fired at once must still lock at
 * five, not at eight. The EXPIRE after it isn't atomic with the INCR, so a
 * crash between the two leaves a counter with no TTL; a correct password
 * clears it anyway.
 */
export async function noteWrongPassword(): Promise<{ remaining: number; locked: boolean }> {
  if (!isConfigured()) return { remaining: MAX_FAILS, locked: false };
  try {
    const fails = Number(await command<number>(["INCR", FAILS_KEY]));
    if (fails === 1) await command(["EXPIRE", FAILS_KEY, FAILS_WINDOW_S]);
    if (fails < MAX_FAILS) return { remaining: MAX_FAILS - fails, locked: false };
    // No TTL. It sticks until someone unlocks it.
    await command(["SET", LOCKDOWN_KEY, "1"]);
    return { remaining: 0, locked: true };
  } catch {
    return { remaining: MAX_FAILS, locked: false };
  }
}

/** After a correct password. Yesterday's typos shouldn't add up to a lockout. */
export async function clearFailures(): Promise<void> {
  if (!isConfigured()) return;
  try {
    await command(["DEL", FAILS_KEY]);
  } catch {
    // Nothing to do about it here; the guess was correct either way.
  }
}

/** The unlock code's whole job. */
export async function liftLockdown(): Promise<void> {
  if (!isConfigured()) return;
  await command(["DEL", LOCKDOWN_KEY]);
  await command(["DEL", FAILS_KEY]);
}

/**
 * True when the request carries a valid, unexpired studio session cookie and
 * the studio isn't locked down. False whenever PASSWORD isn't set — fails
 * closed, same as studio-auth.
 *
 * Named away from the old sync isUnlockedRequest on purpose: `if (!check(req))`
 * on a promise is always false, so a caller that forgot the await would let
 * everyone through and still typecheck.
 */
export async function requireUnlocked(req: VercelRequest): Promise<boolean> {
  const password = process.env.PASSWORD;
  if (!password) return false;
  const cookie = readCookie(req, STUDIO_COOKIE_NAME);
  if (!cookie || !verifyStudioToken(cookie, password)) return false;
  // Lockdown kills sessions that were already signed in, not just new logins.
  return !(await isLockedDown());
}
