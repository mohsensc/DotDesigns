import type { VercelRequest, VercelResponse } from "@vercel/node";
import { del } from "@vercel/blob";
import { isConfigured, readCatalog, writeCatalog } from "./_lib/catalog";
import {
  ValidationError,
  applyOrder,
  blobUrlsOf,
  removePiece,
  sanitisePiece,
  upsertPiece as upsertInCatalog,
} from "./_lib/catalog-shape";
import { parseAmount, removePiece as removeInventoryRow, upsertPiece as upsertInventoryRow } from "./_lib/inventory";
import { isUnlockedRequest } from "./_lib/studio-session";

// The studio's only door onto the live catalog.
//
//   GET          -> everything, drafts included
//   PUT          -> save one piece (and its price/stock row) in one tap
//   POST         -> reorder
//   DELETE ?id=  -> remove the piece, its stock row, and its photos
//
// Every write carries the updatedAt the client loaded. If the stored one has
// moved on, someone else (or her other tab) saved first, and we hand back 409
// plus the current catalog rather than silently flattening their work.
//
// Session first, before we even admit whether storage is configured — same
// ordering as api/studio-inventory.ts.

type Body = Record<string, unknown>;

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

function queryParam(req: VercelRequest, name: string): string {
  const raw = req.query[name];
  return ((Array.isArray(raw) ? raw[0] : raw) ?? "").trim();
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/** Best effort. A photo left behind costs storage; a failed delete shouldn't
 *  block removing the piece from the site. */
async function dropBlobs(urls: string[]): Promise<void> {
  if (!urls.length) return;
  try {
    await del(urls);
  } catch {
    // nothing to do about it here
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const method = req.method ?? "GET";
  if (!["GET", "PUT", "POST", "DELETE"].includes(method)) {
    res.setHeader("Allow", "GET, PUT, POST, DELETE");
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  if (!isUnlockedRequest(req)) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }

  if (!isConfigured()) {
    res.status(500).json({ error: "Catalog storage isn't set up yet." });
    return;
  }

  try {
    const catalog = await readCatalog();

    if (method === "GET") {
      res.status(200).json({ catalog });
      return;
    }

    const body = parseBody(req);
    const expected = asString(body.expectedUpdatedAt) || queryParam(req, "expectedUpdatedAt");

    if (method === "PUT") {
      const raw = (body.piece ?? {}) as Body;
      const existing = catalog.pieces.find(p => p.id === asString(raw.id));

      // Price goes through the ledger's parser before anything else touches it
      // — one rule for what counts as an amount, wherever it was typed.
      let price: number | null = null;
      if (raw.price !== null && raw.price !== undefined && raw.price !== "") {
        price = parseAmount(raw.price);
        if (price === null) {
          res.status(400).json({ error: "That price isn't a plain number. Try something like 1200." });
          return;
        }
      }
      const piece = sanitisePiece({ ...raw, price }, existing);

      const quantity = parseAmount(body.quantity);
      if (quantity === null || !Number.isInteger(quantity)) {
        res.status(400).json({ error: "How many? A whole number, 0 or more." });
        return;
      }

      const next = upsertInCatalog(catalog, piece);
      const write = await writeCatalog(next, expected);
      if (!write.ok) {
        res.status(409).json({ error: "Someone saved before you. Reloaded — try again.", catalog: write.catalog });
        return;
      }

      // The catalog is what the shop reads; the inventory row is what the
      // checkout charges against. Both get written on one tap so they can't
      // disagree about a piece she just edited.
      await upsertInventoryRow({
        slug: piece.slug,
        title: piece.title,
        price: piece.price,
        quantity,
        notes: asString(body.notes),
      });
      // A rename leaves the old row behind. Clear it so the shop can't buy a
      // piece at an address that no longer exists.
      if (existing && existing.slug !== piece.slug) await removeInventoryRow(existing.slug);

      res.status(200).json({ catalog: write.catalog });
      return;
    }

    if (method === "POST") {
      const next = applyOrder(catalog, body.order);
      const write = await writeCatalog(next, expected);
      if (!write.ok) {
        res.status(409).json({ error: "Someone saved before you. Reloaded — try again.", catalog: write.catalog });
        return;
      }
      res.status(200).json({ catalog: write.catalog });
      return;
    }

    // DELETE
    const id = queryParam(req, "id") || asString(body.id);
    if (!id) {
      res.status(400).json({ error: "Missing id." });
      return;
    }
    const doomed = catalog.pieces.find(p => p.id === id);
    if (!doomed) {
      res.status(404).json({ error: "That piece is already gone." });
      return;
    }
    const next = removePiece(catalog, id);
    const write = await writeCatalog(next, expected);
    if (!write.ok) {
      res.status(409).json({ error: "Someone saved before you. Reloaded — try again.", catalog: write.catalog });
      return;
    }
    await removeInventoryRow(doomed.slug);
    await dropBlobs(blobUrlsOf(doomed));
    res.status(200).json({ catalog: write.catalog });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(502).json({ error: "Couldn't reach the catalog. Try again in a moment." });
  }
}
