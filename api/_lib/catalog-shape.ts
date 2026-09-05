// The catalog's rules, with no storage attached.
//
// Everything here is pure so it can be unit tested without Redis, and so it
// imports no JSON — Node's test runner loads these .ts files directly.
// api/_lib/catalog.ts is the part that talks to Redis.
//
// Types come from the client contract (type-only import, erased at runtime).
// The allowed-value lists below are duplicated because importing the client's
// label maps for real would drag client code into a serverless function.

import type { Catalog, MediaKind, MediaRef, Piece, PieceCategory, PieceStatus, Size, SizeUnit } from "../../client/src/lib/catalog";

export const CATALOG_KEY = "catalog:v1";
/** CAS witness. Written in the same Lua script as the catalog, never alone. */
export const CATALOG_STAMP_KEY = "catalog:v1:updatedAt";

const CATEGORIES: PieceCategory[] = ["wall-relief", "sculpture", "pottery", "commission"];
const STATUSES: PieceStatus[] = ["available", "sold", "reserved", "draft"];
const UNITS: SizeUnit[] = ["cm", "in", "m"];
const KINDS: MediaKind[] = ["image", "video"];

// Long enough for a real description, short enough that one bad paste can't
// push the whole catalog past Redis' value limit.
const LIMITS = {
  title: 120,
  blurb: 400,
  description: 8000,
  dimensions: 200,
  materials: 200,
  caption: 300,
  media: 24,
  pieces: 500,
};

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Vercel Blob's public host. Anything else in a media src is refused. */
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export class ValidationError extends Error {}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function clean(v: unknown, max: number, field: string): string {
  const s = str(v).replace(/\r\n/g, "\n").trim();
  if (s.length > max) throw new ValidationError(`${field} is too long (max ${max} characters).`);
  return s;
}

/**
 * Lowercase, ASCII, hyphens. This ends up in a URL and in a prerendered
 * directory name, so anything that isn't [a-z0-9-] is dropped rather than
 * escaped — a slug with a %20 in it is nobody's friend.
 */
export function slugify(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function validSrc(src: string): boolean {
  // Two shapes are legitimate: a blob we uploaded, and a file that ships with
  // the build (the demo pieces point at /world/*.webp). Everything else is
  // someone else's host, which is not going in an <img> on this site.
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  try {
    const u = new URL(src);
    return u.protocol === "https:" && u.hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}

function sanitiseMedia(raw: unknown): MediaRef[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > LIMITS.media) throw new ValidationError(`That's more than ${LIMITS.media} photos on one piece.`);
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const m = (entry ?? {}) as Record<string, unknown>;
    const id = str(m.id);
    if (!ID_RE.test(id)) throw new ValidationError(`Photo ${i + 1} has a bad id.`);
    if (seen.has(id)) throw new ValidationError("Two photos on this piece share an id.");
    seen.add(id);
    const kind = KINDS.includes(m.kind as MediaKind) ? (m.kind as MediaKind) : "image";
    const src = str(m.src).trim();
    if (!validSrc(src)) throw new ValidationError(`Photo ${i + 1} isn't stored on this site.`);
    const ref: MediaRef = { id, kind, src };
    const caption = clean(m.caption, LIMITS.caption, "A caption");
    if (caption) ref.caption = caption;
    const w = num(m.width);
    const h = num(m.height);
    if (w && w > 0) ref.width = Math.round(w);
    if (h && h > 0) ref.height = Math.round(h);
    return ref;
  });
}

function sanitiseSize(raw: unknown): Size | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  const unit = UNITS.includes(s.unit as SizeUnit) ? (s.unit as SizeUnit) : "cm";
  const out: Size = { unit };
  for (const key of ["height", "length", "depth"] as const) {
    const v = num(s[key]);
    if (v !== null && v > 0) out[key] = v;
  }
  if (out.height === undefined && out.length === undefined && out.depth === undefined) return undefined;
  return out;
}

/**
 * Rebuilds a piece field by field from whatever the studio posted. Unknown
 * fields don't survive, so a client can't smuggle extra keys into a blob the
 * public site renders. Throws ValidationError with a message Hajar can read.
 */
export function sanitisePiece(raw: unknown, existing?: Piece): Piece {
  if (!raw || typeof raw !== "object") throw new ValidationError("No piece in that request.");
  const p = raw as Record<string, unknown>;

  const id = str(p.id).trim();
  if (!ID_RE.test(id)) throw new ValidationError("That piece has a bad id.");

  const title = clean(p.title, LIMITS.title, "The name");
  if (!title) throw new ValidationError("Give the piece a name first.");

  const slug = slugify(str(p.slug) || title);
  if (!slug) throw new ValidationError("That name doesn't make a usable web address. Add some letters or numbers.");

  const price = priceOf(p.price);

  const piece: Piece = {
    id,
    slug,
    title,
    category: CATEGORIES.includes(p.category as PieceCategory) ? (p.category as PieceCategory) : "sculpture",
    status: STATUSES.includes(p.status as PieceStatus) ? (p.status as PieceStatus) : "draft",
    price,
    blurb: clean(p.blurb, LIMITS.blurb, "The short line"),
    description: clean(p.description, LIMITS.description, "The description"),
    media: sanitiseMedia(p.media),
    order: num(p.order) ?? existing?.order ?? 0,
    createdAt: isoOr(p.createdAt, existing?.createdAt),
  };

  const year = num(p.year);
  if (year !== null && year >= 1900 && year <= 2100) piece.year = Math.trunc(year);

  const size = sanitiseSize(p.size);
  if (size) piece.size = size;

  const dimensions = clean(p.dimensions, LIMITS.dimensions, "The size text");
  if (dimensions) piece.dimensions = dimensions;

  const materials = clean(p.materials, LIMITS.materials, "The materials");
  if (materials) piece.materials = materials;

  const coverId = str(p.coverId);
  if (coverId && piece.media.some(m => m.id === coverId)) piece.coverId = coverId;

  return piece;
}

/**
 * Blank means not for sale — never zero, never free.
 *
 * A number by the time it gets here: the endpoint runs whatever she typed
 * through inventory.ts' parseAmount first, so the rule about "1200 (was 1500)"
 * lives in one place. Anything else that reaches this is a bug, not a typo, and
 * is refused rather than coerced into a price someone gets charged.
 */
function priceOf(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw new ValidationError("That price isn't a plain number. Try something like 1200.");
  }
  return raw;
}

function isoOr(raw: unknown, fallback?: string): string {
  const s = str(raw);
  if (s && !Number.isNaN(Date.parse(s))) return s;
  return fallback ?? new Date().toISOString();
}

export function emptyCatalog(): Catalog {
  return { version: 1, pieces: [], updatedAt: new Date().toISOString() };
}

/** Parses whatever came out of Redis. Anything unrecognisable is treated as absent. */
export function parseStoredCatalog(raw: unknown): Catalog | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as Catalog;
    if (parsed?.version !== 1 || !Array.isArray(parsed.pieces)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function stamped(pieces: Piece[]): Catalog {
  return { version: 1, pieces, updatedAt: new Date().toISOString() };
}

/** Insert or replace by id. Slug has to be unique or the URL is ambiguous. */
export function upsertPiece(catalog: Catalog, piece: Piece): Catalog {
  const clash = catalog.pieces.find(p => p.slug === piece.slug && p.id !== piece.id);
  if (clash) throw new ValidationError(`"${clash.title}" already uses that web address. Change the name a little.`);
  const idx = catalog.pieces.findIndex(p => p.id === piece.id);
  if (idx === -1 && catalog.pieces.length >= LIMITS.pieces) {
    throw new ValidationError("That's the most pieces this catalog holds.");
  }
  const pieces = [...catalog.pieces];
  if (idx === -1) pieces.push(piece);
  else pieces[idx] = piece;
  return stamped(pieces);
}

export function removePiece(catalog: Catalog, id: string): Catalog {
  return stamped(catalog.pieces.filter(p => p.id !== id));
}

/** Ids not mentioned keep their relative order, after the ones that were. */
export function applyOrder(catalog: Catalog, order: unknown): Catalog {
  if (!Array.isArray(order)) throw new ValidationError("That reorder request has no order in it.");
  const wanted = order.filter((id): id is string => typeof id === "string");
  const rank = new Map(wanted.map((id, i) => [id, i]));
  const pieces = catalog.pieces
    .map(p => ({ p, rank: rank.get(p.id) ?? wanted.length + p.order }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ p }, i) => ({ ...p, order: i + 1 }));
  return stamped(pieces);
}

/** What the shop is allowed to see: no drafts, in display order. */
export function publicView(catalog: Catalog): Catalog {
  return {
    version: 1,
    updatedAt: catalog.updatedAt,
    pieces: catalog.pieces.filter(p => p.status !== "draft").sort((a, b) => a.order - b.order),
  };
}

/** Blob urls this catalog still points at, so a delete knows what to keep. */
export function blobUrlsOf(piece: Piece | undefined): string[] {
  if (!piece) return [];
  return piece.media.map(m => m.src).filter(src => src.startsWith("https://"));
}
