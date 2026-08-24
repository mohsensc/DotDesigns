import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getInventory, isConfigured, isSoldOut } from "./_lib/inventory";

// Public read of the stock ledger. Only what a shopper needs to see:
// price, quantity, and whether it's sold out. Never notes — that's Hajar's
// scratch column, not something to expose in an API response.

type InventoryPayload = {
  pieces: Record<string, { price: number | null; quantity: number; soldOut: boolean }>;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  // Not configured yet — the shop still has to render, just with no sheet
  // data. Empty map, not a 500: the catalog's own status field carries on.
  if (!isConfigured()) {
    res.status(200).json({ pieces: {} } satisfies InventoryPayload);
    return;
  }

  try {
    const inventory = await getInventory();
    const pieces: InventoryPayload["pieces"] = {};
    for (const row of inventory.values()) {
      pieces[row.slug] = { price: row.price, quantity: row.quantity, soldOut: isSoldOut(row) };
    }
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    res.status(200).json({ pieces } satisfies InventoryPayload);
  } catch {
    // A Sheets hiccup shouldn't take the shop down. Empty map, same as
    // unconfigured — the client falls back to the catalog's own status.
    res.status(200).json({ pieces: {} } satisfies InventoryPayload);
  }
}
