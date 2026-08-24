// ---------------------------------------------------------------------------
// Client-side read of the stock ledger. Fetched once, looked up by slug.
//
// Fails soft on purpose: if the request errors, callers must fall back to the
// catalog's own status field. Getting this backwards — treating "couldn't
// reach the sheet" as "everything is sold out" — would take the whole shop
// down over a network blip.
// ---------------------------------------------------------------------------

export type StockEntry = { price: number | null; quantity: number; soldOut: boolean };

type InventoryPayload = { pieces: Record<string, StockEntry> };

let cached: Promise<Record<string, StockEntry>> | null = null;

async function fetchInventory(): Promise<Record<string, StockEntry>> {
  try {
    const res = await fetch("/api/inventory");
    if (!res.ok) {
      cached = null; // transient server error — don't cache it as "ledger is empty"
      return {};
    }
    const body = (await res.json()) as InventoryPayload;
    return body?.pieces ?? {};
  } catch {
    // Same idea for a network blip: retry next time rather than freezing
    // the whole page on an empty ledger.
    cached = null;
    return {};
  }
}

/** Fetches once per page load and reuses the result for every caller. */
export function loadInventory(): Promise<Record<string, StockEntry>> {
  if (!cached) cached = fetchInventory();
  return cached;
}

export function stockFor(inventory: Record<string, StockEntry>, slug: string): StockEntry | undefined {
  return inventory[slug];
}
