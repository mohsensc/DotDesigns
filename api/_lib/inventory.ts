// The inventory ledger — server-side source of truth for price and stock.
// This is what makes it safe to charge money: the client never gets to say
// what a piece costs or whether it's still in stock, this does.
//
// Backed by Redis. Layout:
//   inv:slugs          SET of every slug we know about
//   inv:meta:<slug>    JSON blob: title, price, notes, updatedAt
//   inv:qty:<slug>     a bare integer, kept separate on purpose
//
// Quantity lives in its own key so it can be decremented atomically. Folding
// it into the JSON would mean read-modify-write, which is exactly the race
// that lets two people buy the last piece at the same moment.

import { command, eval_, isConfigured } from "./redis";

export { isConfigured };

const SLUGS_KEY = "inv:slugs";
const metaKey = (slug: string) => `inv:meta:${slug}`;
const qtyKey = (slug: string) => `inv:qty:${slug}`;

export type InventoryRow = {
  slug: string;
  title: string;
  /** Dollars, may be fractional. null means not for sale — never coerce to 0. */
  price: number | null;
  quantity: number;
  notes: string;
  updatedAt: string;
};

type StoredMeta = {
  title?: string;
  price?: number | null;
  notes?: string;
  updatedAt?: string;
};

/**
 * Reads a number that a person typed, or refuses.
 *
 * Kept strict even though the input is now a form rather than a spreadsheet
 * cell: pasted values still arrive with currency symbols and stray text, and
 * the failure this guards against is severe. Stripping every non-digit turns
 * "1200 (was 1500)" into 12001500 and charges twelve million dollars for a
 * twelve hundred dollar piece. So: exactly one number, or nothing.
 */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const normalised = raw.replace(/(?<=\d),(?=\d{3}(\D|$))/g, "").replace(/[$\s]/g, "");
  // A minus anywhere means this isn't a plain amount ("-50", "1200-1500").
  if (normalised.includes("-")) return null;
  const tokens = normalised.match(/\d+(?:\.\d+)?/g);
  if (!tokens || tokens.length !== 1) return null;
  const value = Number(tokens[0]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Unreadable quantity means 0 — losing a sale beats selling what's gone. */
export function parseQuantity(raw: unknown): number {
  const value = parseAmount(raw);
  return value === null ? 0 : Math.trunc(value);
}

export function isSoldOut(row: InventoryRow): boolean {
  return row.quantity <= 0;
}

function readMeta(raw: unknown): StoredMeta {
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw) as StoredMeta;
  } catch {
    return {};
  }
}

function rowFrom(slug: string, metaRaw: unknown, qtyRaw: unknown): InventoryRow {
  const meta = readMeta(metaRaw);
  return {
    slug,
    title: meta.title ?? "",
    price: meta.price ?? null,
    quantity: parseQuantity(qtyRaw),
    notes: meta.notes ?? "",
    updatedAt: meta.updatedAt ?? "",
  };
}

export async function getRow(slug: string): Promise<InventoryRow | null> {
  const exists = await command<number>(["SISMEMBER", SLUGS_KEY, slug]);
  if (!exists) return null;
  const [metaRaw, qtyRaw] = await Promise.all([
    command<string | null>(["GET", metaKey(slug)]),
    command<string | null>(["GET", qtyKey(slug)]),
  ]);
  return rowFrom(slug, metaRaw, qtyRaw);
}

export async function getInventory(): Promise<Map<string, InventoryRow>> {
  const slugs = (await command<string[]>(["SMEMBERS", SLUGS_KEY])) ?? [];
  const map = new Map<string, InventoryRow>();
  if (!slugs.length) return map;

  // One round trip each for metas and quantities rather than two per slug.
  const [metas, qtys] = await Promise.all([
    command<(string | null)[]>(["MGET", ...slugs.map(metaKey)]),
    command<(string | null)[]>(["MGET", ...slugs.map(qtyKey)]),
  ]);

  slugs.forEach((slug, i) => {
    map.set(slug, rowFrom(slug, metas?.[i], qtys?.[i]));
  });
  return map;
}

/** Creates or updates a piece. Quantity is written straight, not decremented. */
export async function upsertPiece(piece: {
  slug: string;
  title: string;
  price: number | null;
  quantity: number;
  notes: string;
}): Promise<void> {
  const meta: StoredMeta = {
    title: piece.title,
    price: piece.price,
    notes: piece.notes,
    updatedAt: new Date().toISOString(),
  };
  await Promise.all([
    command(["SADD", SLUGS_KEY, piece.slug]),
    command(["SET", metaKey(piece.slug), JSON.stringify(meta)]),
    command(["SET", qtyKey(piece.slug), String(Math.max(0, Math.trunc(piece.quantity)))]),
  ]);
}

/** Kept as the old name too — several endpoints were written against it. */
export const appendPiece = upsertPiece;

export async function setQuantity(slug: string, quantity: number): Promise<void> {
  const exists = await command<number>(["SISMEMBER", SLUGS_KEY, slug]);
  if (!exists) throw new Error("No inventory entry for that slug.");
  await command(["SET", qtyKey(slug), String(Math.max(0, Math.trunc(quantity)))]);
}

export async function removePiece(slug: string): Promise<void> {
  await Promise.all([
    command(["SREM", SLUGS_KEY, slug]),
    command(["DEL", metaKey(slug)]),
    command(["DEL", qtyKey(slug)]),
  ]);
}

// Check-and-decrement in one server-side step. Doing this as a GET then a SET
// from here would leave a window where two checkouts both read 1 and both
// decide the piece is available — the exact oversell the spreadsheet version
// could not close. Returns the new quantity, or -1 if there was nothing left.
const DECREMENT_LUA = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current <= 0 then return -1 end
local remaining = current - tonumber(ARGV[1])
if remaining < 0 then remaining = 0 end
redis.call('SET', KEYS[1], remaining)
return remaining
`;

export async function decrementQuantity(slug: string, by: number): Promise<number> {
  const result = await eval_<number>(DECREMENT_LUA, [qtyKey(slug)], [Math.max(1, Math.trunc(by))]);
  return typeof result === "number" ? result : 0;
}

/** No cache to clear any more — reads go straight to Redis. Kept so callers compile. */
export function invalidateInventoryCache(): void {
  /* nothing to do */
}
