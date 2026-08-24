import type { VercelRequest, VercelResponse } from "@vercel/node";
import { appendPiece, getRow, isConfigured } from "./_lib/inventory";
import { isUnlockedRequest } from "./_lib/studio-session";

// Bridges the studio to the Google Sheet Hajar actually edits stock in.
// GET  ?slug=x  -> current quantity/notes for that slug, so the form can show
//                  what's really in the sheet instead of guessing.
// POST { slug, title, price, quantity, notes } -> appendPiece(), so a save in
//                  the studio shows up as a row.
//
// Both need a live studio session — this writes to (and, via GET, exposes
// notes/quantity of) a real spreadsheet, so it's checked before anything else,
// including before we say whether the sheet is even configured.

function spreadsheetUrl(): string | null {
  const id = process.env.GOOGLE_SHEETS_ID;
  if (!id) return null;
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

type SheetBody = {
  slug?: unknown;
  title?: unknown;
  price?: unknown;
  quantity?: unknown;
  notes?: unknown;
};

function parseBody(req: VercelRequest): SheetBody {
  const body = req.body;
  if (body && typeof body === "object") return body as SheetBody;
  if (typeof body === "string" && body.length > 0) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object") return parsed as SheetBody;
    } catch {
      // not JSON — fall through to empty
    }
  }
  return {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  if (!isUnlockedRequest(req)) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }

  if (!isConfigured()) {
    res.status(500).json({ error: "not configured" });
    return;
  }

  const url = spreadsheetUrl();

  if (req.method === "GET") {
    const rawSlug = req.query.slug;
    const slug = ((Array.isArray(rawSlug) ? rawSlug[0] : rawSlug) ?? "").trim();
    if (!slug) {
      res.status(400).json({ error: "Missing slug." });
      return;
    }
    try {
      const row = await getRow(slug);
      res.status(200).json({
        quantity: row ? row.quantity : null,
        notes: row ? row.notes : "",
        url,
      });
    } catch {
      res.status(502).json({ error: "Couldn't reach the inventory sheet." });
    }
    return;
  }

  // POST
  const body = parseBody(req);
  const slug = asString(body.slug).trim();
  const title = asString(body.title).trim();
  const notes = asString(body.notes);

  if (!slug) {
    res.status(400).json({ error: "Missing slug." });
    return;
  }
  if (!title) {
    res.status(400).json({ error: "Missing title." });
    return;
  }

  let price: number | null = null;
  if (body.price !== null && body.price !== undefined && body.price !== "") {
    const n = Number(body.price);
    if (!Number.isFinite(n) || n < 0) {
      res.status(400).json({ error: "Price must be a non-negative number." });
      return;
    }
    price = n;
  }

  const quantity = Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 0) {
    res.status(400).json({ error: "Quantity must be a whole number, 0 or more." });
    return;
  }

  try {
    await appendPiece({ slug, title, price, quantity, notes });
    res.status(200).json({ ok: true, url });
  } catch {
    res.status(502).json({ error: "Couldn't reach the inventory sheet. Try again in a moment." });
  }
}
