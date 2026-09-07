import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getInventory,
  getRow,
  isConfigured,
  parseAmount,
  removePiece,
  upsertPiece,
} from "./_lib/inventory";
import { requireUnlocked } from "./_lib/studio-lockdown";

// The studio's inventory table talks to this.
//
//   GET            -> every entry, for the grid
//   GET ?slug=x    -> one entry, for the piece form
//   POST           -> create or update one entry
//   DELETE ?slug=x -> remove one entry
//
// All of it needs a live studio session. This is the only writable door onto
// the numbers the checkout charges against, so the session is checked before
// anything else — including before we admit whether storage is configured.

type Body = {
  slug?: unknown;
  title?: unknown;
  price?: unknown;
  quantity?: unknown;
  notes?: unknown;
};

function parseBody(req: VercelRequest): Body {
  const body = req.body;
  if (body && typeof body === "object") return body as Body;
  if (typeof body === "string" && body.length > 0) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object") return parsed as Body;
    } catch {
      // not JSON — fall through to empty
    }
  }
  return {};
}

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

function slugParam(req: VercelRequest): string {
  const raw = req.query.slug;
  return ((Array.isArray(raw) ? raw[0] : raw) ?? "").trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const method = req.method ?? "GET";
  if (!["GET", "POST", "DELETE"].includes(method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  if (!(await requireUnlocked(req))) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }

  if (!isConfigured()) {
    res.status(500).json({ error: "Inventory storage isn't set up yet." });
    return;
  }

  try {
    if (method === "GET") {
      const slug = slugParam(req);
      if (slug) {
        const row = await getRow(slug);
        res.status(200).json({ row });
        return;
      }
      const all = await getInventory();
      // Sorted so the table doesn't reshuffle itself between loads.
      const rows = [...all.values()].sort((a, b) => a.title.localeCompare(b.title));
      res.status(200).json({ rows });
      return;
    }

    if (method === "DELETE") {
      const slug = slugParam(req);
      if (!slug) {
        res.status(400).json({ error: "Missing slug." });
        return;
      }
      await removePiece(slug);
      res.status(200).json({ ok: true });
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
      res.status(400).json({ error: "Give the piece a name first." });
      return;
    }

    // Blank price is allowed and means "not for sale" — it hides the buy
    // button rather than charging zero. Anything unparseable is refused
    // outright instead of being coerced into a number someone gets charged.
    let price: number | null = null;
    const rawPrice = body.price;
    if (rawPrice !== null && rawPrice !== undefined && rawPrice !== "") {
      price = parseAmount(rawPrice);
      if (price === null) {
        res.status(400).json({ error: "That price isn't a plain number. Try something like 1200." });
        return;
      }
    }

    const quantity = parseAmount(body.quantity);
    if (quantity === null || !Number.isInteger(quantity)) {
      res.status(400).json({ error: "How many? A whole number, 0 or more." });
      return;
    }

    await upsertPiece({ slug, title, price, quantity, notes });
    res.status(200).json({ ok: true });
  } catch {
    res.status(502).json({ error: "Couldn't reach your inventory. Try again in a moment." });
  }
}
