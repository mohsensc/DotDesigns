// ---------------------------------------------------------------------------
// Client-side read of the stock ledger. Fetched once, looked up by slug.
//
// Fails soft on purpose: if the request errors, callers must fall back to the
// catalog's own status field. Getting this backwards — treating "couldn't
// reach the sheet" as "everything is sold out" — would take the whole shop
// down over a network blip.
//
// But soft is not the same as silent. A failed read and a ledger with no rows
// used to arrive here identically, so a dead ledger rendered as an ordinary
// quiet "Enquire" next to a firm price and nobody could tell. `unavailable`
// says which one happened; callers show the difference.
// ---------------------------------------------------------------------------

export type StockEntry = { price: number | null; quantity: number; soldOut: boolean };

export type InventoryResult = {
  pieces: Record<string, StockEntry>;
  /** The read failed. Not the same as a ledger that genuinely has no rows. */
  unavailable: boolean;
};

type InventoryPayload = { pieces: Record<string, StockEntry> };

let cached: Promise<InventoryResult> | null = null;

async function fetchInventory(): Promise<InventoryResult> {
  try {
    const res = await fetch("/api/inventory");
    if (!res.ok) {
      cached = null; // transient server error — don't cache it as "ledger is empty"
      return { pieces: {}, unavailable: true };
    }
    const body = (await res.json()) as InventoryPayload;
    return { pieces: body?.pieces ?? {}, unavailable: false };
  } catch {
    // Same idea for a network blip: retry next time rather than freezing
    // the whole page on an empty ledger.
    cached = null;
    return { pieces: {}, unavailable: true };
  }
}

/** Fetches once per page load and reuses the result for every caller. */
export function loadInventory(): Promise<InventoryResult> {
  if (!cached) cached = fetchInventory();
  return cached;
}
