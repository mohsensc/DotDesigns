// Minimal Google Sheets v4 client, authenticated as a service account.
// No googleapis, no google-auth-library — hand-rolled JWT + fetch, same
// spirit as api/inquiry.ts calling Resend with plain fetch.
//
// Auth flow: sign a JWT with the service account's private key, trade it
// for a bearer token at Google's OAuth endpoint, then call the Sheets API
// with that token. The access token is cached in module scope so a warm
// serverless instance doesn't re-mint one on every request.

import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_LIFETIME_SECONDS = 3600;
const TOKEN_REFRESH_MARGIN_SECONDS = 300; // re-mint 5 minutes before expiry

let cachedToken: { accessToken: string; expiresAtMs: number } | null = null;

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function readEnv() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!email || !rawKey || !sheetId) return null;
  // Vercel stores multi-line env values with literal "\n" sequences rather
  // than real newlines — without this the PEM won't parse and every call
  // fails with an opaque crypto error.
  const privateKey = rawKey.replace(/\\n/g, "\n");
  return { email, privateKey, sheetId };
}

/** True when every required env var is present. Callers should fail closed when false. */
export function isConfigured(): boolean {
  return readEnv() !== null;
}

function signJwt(email: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + TOKEN_LIFETIME_SECONDS,
    iat: now,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

async function getAccessToken(): Promise<string> {
  const env = readEnv();
  if (!env) throw new Error("Google Sheets is not configured.");

  const nowMs = Date.now();
  if (cachedToken && cachedToken.expiresAtMs - TOKEN_REFRESH_MARGIN_SECONDS * 1000 > nowMs) {
    return cachedToken.accessToken;
  }

  const assertion = signJwt(env.email, env.privateKey);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    // Never include the response body — it can echo back request details.
    throw new Error("Failed to obtain Google access token.");
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Google token response missing access_token.");

  cachedToken = {
    accessToken: json.access_token,
    expiresAtMs: nowMs + (json.expires_in ?? TOKEN_LIFETIME_SECONDS) * 1000,
  };
  return cachedToken.accessToken;
}

async function sheetsFetch(path: string, init?: RequestInit): Promise<unknown> {
  const env = readEnv();
  if (!env) throw new Error("Google Sheets is not configured.");
  const token = await getAccessToken();

  const res = await fetch(`${SHEETS_API}/${env.sheetId}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Google Sheets request failed (${res.status}).`);
  }
  return res.json();
}

/**
 * Reads a range and returns Google's raw string[][]. Google omits trailing
 * empty cells from each row — a row that only fills columns A and B comes
 * back as length 2, not padded to the sheet's full width. Every caller must
 * tolerate short rows rather than indexing off the end.
 */
export async function readRange(a1Range: string): Promise<string[][]> {
  const json = (await sheetsFetch(`/values/${encodeURIComponent(a1Range)}`)) as {
    values?: string[][];
  };
  return json.values ?? [];
}

/** Appends a row after the last row of data in the given range's sheet. */
export async function appendRow(a1Range: string, values: (string | number)[]): Promise<void> {
  await sheetsFetch(
    `/values/${encodeURIComponent(a1Range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values: [values] }),
    },
  );
}

/** Overwrites the given range with a single row of values. */
export async function updateRange(a1Range: string, values: (string | number)[]): Promise<void> {
  await sheetsFetch(`/values/${encodeURIComponent(a1Range)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [values] }),
  });
}
