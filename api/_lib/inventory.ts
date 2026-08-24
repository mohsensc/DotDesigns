// The inventory ledger — server-side source of truth for price and stock.
// This is what makes it safe to charge money: the client never gets to say
// what a piece costs or whether it's still in stock, this sheet does.
//
// Sheet tab "Inventory", row 1 header, columns A-F:
//   slug | title | price_cad | quantity | notes | updated_at
// A piece is sold out when quantity <= 0. No separate status column —
// that's deliberate, it keeps one number for Hajar to edit.

import { appendRow, isConfigured, readRange, updateRange } from "./google-sheets";

// Re-exported so endpoint code only needs one import to check "is Sheets
// configured" before touching inventory, instead of reaching into
// google-sheets.ts directly.
export { isConfigured };

const SHEET_NAME = "Inventory";
const DATA_RANGE = `${SHEET_NAME}!A2:F`;
const CACHE_TTL_MS = 60_000;

export type InventoryRow = {
  slug: string;
  title: string;
  /** Dollars, may be fractional ("1200.50" parses to 1200.5). null means unparseable / not for sale — never coerce to 0. */
  price: number | null;
  quantity: number;
  notes: string;
  updatedAt: string;
  /** 1-based row number in the sheet, needed to write back to this row. */
  rowNumber: number;
};

let cache: { at: number; rows: Map<string, InventoryRow> } | null = null;

function bustCache(): void {
  cache = null;
}

async function readFresh(): Promise<Map<string, InventoryRow>> {
  const rows = await readRange(DATA_RANGE);
  const map = new Map<string, InventoryRow>();
  rows.forEach((row, i) => {
    // DATA_RANGE starts at row 2, so index 0 of `rows` is sheet row 2.
    const parsed = rowToInventoryRow(row, i + 2);
    if (parsed) map.set(parsed.slug, parsed);
  });
  cache = { at: Date.now(), rows: map };
  return map;
}

/**
 * Pulls the one number out of a spreadsheet cell, or refuses.
 *
 * "$1,200", " 1200 ", "1200.50" all resolve. "", "sold", "TBD" become null —
 * null means not purchasable, and that is the safe direction to fail.
 *
 * The subtle part is a cell holding MORE than one number. Stripping every
 * non-digit and parsing what's left turns "1200 (was 1500)" into 12001500 and
 * charges twelve million dollars for a twelve hundred dollar piece. So the
 * separators come out first, then the remaining number-like tokens are counted:
 * exactly one is a price, anything else is ambiguous and refused. A note in the
 * price cell should stop a sale, never invent one.
 */
function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  // Drop currency symbols, spaces, and thousands separators sitting between
  // digits ("1,200" is one number; "1200, 1500" is two).
  const normalised = raw.replace(/(?<=\d),(?=\d{3}(\D|$))/g, "").replace(/[$\s]/g, "");
  // A minus anywhere means the cell isn't a plain amount ("-50", "1200-1500").
  // Stripping it would turn a negative into a positive charge.
  if (normalised.includes("-")) return null;
  const tokens = normalised.match(/\d+(?:\.\d+)?/g);
  if (!tokens || tokens.length !== 1) return null;
  const value = Number(tokens[0]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function parsePrice(raw: string | undefined): number | null {
  return parseAmount(raw);
}

/**
 * Same one-number-or-nothing rule as the price, but an unreadable quantity
 * degrades to 0 rather than null. "2 (one reserved)" is ambiguous, and reading
 * it as 21 would keep selling a piece that's nearly gone — treating it as sold
 * out costs a sale, which is the cheaper mistake.
 */
function parseQuantity(raw: string | undefined): number {
  const value = parseAmount(raw);
  return value === null ? 0 : Math.trunc(value);
}

function rowToInventoryRow(row: string[], rowNumber: number): InventoryRow | null {
  const slug = (row[0] ?? "").trim();
  if (!slug) return null;
  return {
    slug,
    title: (row[1] ?? "").trim(),
    price: parsePrice(row[2]),
    quantity: parseQuantity(row[3]),
    notes: (row[4] ?? "").trim(),
    updatedAt: (row[5] ?? "").trim(),
    rowNumber,
  };
}

export async function getInventory(): Promise<Map<string, InventoryRow>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  return readFresh();
}

export async function getRow(slug: string): Promise<InventoryRow | null> {
  const inventory = await getInventory();
  return inventory.get(slug) ?? null;
}

// Read-modify-write callers (append/setQuantity/decrementQuantity) can't go
// through the cached getRow — up to 60s of staleness there would mean a
// checkout or a duplicate-slug check reasoning about numbers Hajar already
// changed. They read fresh instead; only plain lookups use the cache.
async function getRowFresh(slug: string): Promise<InventoryRow | null> {
  const inventory = await readFresh();
  return inventory.get(slug) ?? null;
}

export function isSoldOut(row: InventoryRow): boolean {
  return row.quantity <= 0;
}

export async function appendPiece(piece: {
  slug: string;
  title: string;
  price: number | null;
  quantity: number;
  notes: string;
}): Promise<void> {
  const existing = await getRowFresh(piece.slug);
  const updatedAt = new Date().toISOString();
  const values = [
    piece.slug,
    piece.title,
    piece.price ?? "",
    piece.quantity,
    piece.notes,
    updatedAt,
  ];

  if (existing) {
    await updateRange(`${SHEET_NAME}!A${existing.rowNumber}:F${existing.rowNumber}`, values);
  } else {
    await appendRow(DATA_RANGE, values);
  }
  bustCache();
}

export async function setQuantity(slug: string, quantity: number): Promise<void> {
  const row = await getRowFresh(slug);
  if (!row) throw new Error("No inventory row for that slug.");
  await updateRange(`${SHEET_NAME}!D${row.rowNumber}:F${row.rowNumber}`, [
    quantity,
    row.notes,
    new Date().toISOString(),
  ]);
  bustCache();
}

/**
 * Subtracts `by` from a piece's stock and writes the result back.
 *
 * Honesty about the failure mode: a spreadsheet has no transactions. This
 * reads fresh (bypassing the 60s cache) so the window isn't cache-shaped,
 * but two checkouts racing on the last unit can still both read quantity=1
 * in the gap between this read and this write, and both decide "in stock".
 * This clamps the result at zero so the number never goes negative, but it
 * does not prevent overselling by one unit under real concurrency. At this
 * scale (one small studio, one-off pieces) that's an acceptable risk, not a
 * solved problem — a real fix needs a database with actual row locking.
 */
export async function decrementQuantity(slug: string, by: number): Promise<number> {
  const row = await getRowFresh(slug);
  if (!row) throw new Error("No inventory row for that slug.");
  const next = Math.max(0, row.quantity - by);
  await updateRange(`${SHEET_NAME}!D${row.rowNumber}:F${row.rowNumber}`, [
    next,
    row.notes,
    new Date().toISOString(),
  ]);
  bustCache();
  return next;
}

/** Exposed for callers that write to the sheet through other means and need the cache invalidated. */
export function invalidateInventoryCache(): void {
  bustCache();
}
