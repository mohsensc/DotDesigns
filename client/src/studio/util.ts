// Small shared helpers for the studio views.

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function slugify(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `piece-${Date.now()}`;
}

export const MIN_PRICE = 0.5;

export type PriceReading = { ok: true; price: number | null } | { ok: false };

export function readPrice(raw: string): PriceReading {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, price: null };
  const normalised = trimmed.replace(/(?<=\d),(?=\d{3}(\D|$))/g, "").replace(/[$\s]/g, "");
  if (normalised.includes("-")) return { ok: false };
  const tokens = normalised.match(/\d+(?:\.\d+)?/g);
  if (!tokens || tokens.length !== 1) return { ok: false };
  const price = Number(tokens[0]);
  if (!Number.isFinite(price) || price < MIN_PRICE) return { ok: false };
  return { ok: true, price };
}
