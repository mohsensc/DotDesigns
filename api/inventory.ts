import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getInventory, isConfigured, isSoldOut } from "./_lib/inventory";

// Public read of the stock ledger. Only what a shopper needs to see:
// price, quantity, and whether it's sold out. Never notes — that's Hajar's
// scratch column, not something to expose in an API response.

type InventoryPayload = {
  pieces: Record<string, { price: number | null; quantity: number; soldOut: boolean }>;
};

type ErrorPayload = { error: string };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  // An unreadable ledger is not an empty one. Answering 200 {"pieces":{}} here
  // made the two look identical, so a store with no Redis credentials rendered
  // as a shop where every piece happens to have no stock row — priced, listed,
  // and quietly unbuyable. 503 lets the client say which it is.
  if (!isConfigured()) {
    res.status(503).json({ error: "The stock ledger isn't available right now." } satisfies ErrorPayload);
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
    // Same as unconfigured: the shop still renders, but off the catalog alone
    // and knowing it. The client must never read this as "everything is sold".
    res.status(503).json({ error: "The stock ledger isn't available right now." } satisfies ErrorPayload);
  }
}
