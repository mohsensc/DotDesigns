// ---------------------------------------------------------------------------
// The catalog contract.
//
// One shape, three consumers: the public shop reads it, the studio writes it,
// and api/_lib/catalog.ts stores it in Redis. The demo pieces live in
// shared/catalog.demo.json because Node reads that one too — the API's empty
// state and scripts/build.mjs' prerender fallback.
//
// A MediaRef is just a URL now: a file that ships with the build, or a blob the
// studio uploaded. Nothing to resolve asynchronously any more.
// ---------------------------------------------------------------------------

export type MediaKind = "image" | "video";

export type MediaRef = {
  id: string;
  kind: MediaKind;
  /** Where the file actually is. A build path, or a Vercel Blob URL. */
  src: string;
  /** Natural pixel size when the studio knew it. Lets the grid reserve space. */
  width?: number;
  height?: number;
  /**
   * What the photo shows, in Hajar's words. Printed under the image AND used as
   * the alt attribute — she writes one visible caption and never sees the word
   * "alt". Use altOf() rather than reading this directly.
   */
  caption?: string;
};

/** What the piece is. Drives filtering and the default price band. */
export type PieceCategory = "wall-relief" | "sculpture" | "pottery" | "commission";

/** Availability. `sold` still shows — sold work is the strongest proof there is. */
export type PieceStatus = "available" | "sold" | "reserved" | "draft";

export type SizeUnit = "cm" | "in" | "m";

/**
 * Real measurements, kept as numbers so the scale drawing can be to proportion.
 * Optional throughout: an on-site commission genuinely has no fixed size, and
 * `dimensions` carries the words for that case.
 */
export type Size = {
  unit: SizeUnit;
  height?: number;
  length?: number;
  /** Only meaningful for work in the round. Absent on flat wall pieces. */
  depth?: number;
};

export type Piece = {
  id: string;
  /** URL-safe, stable across renames. */
  slug: string;
  title: string;
  year?: number;
  category: PieceCategory;
  status: PieceStatus;
  /** CAD, whole dollars. Null means "price on request". */
  price: number | null;
  /** One or two lines for the grid card. */
  blurb: string;
  /** The long description on the piece page. Plain text, newlines allowed. */
  description: string;
  /** Numbers, when there are any. Drives ScaleFigure and the printed size. */
  size?: Size;
  /**
   * Free text, for the pieces that have no fixed measurements ("Sized to the
   * wall"). When `size` is set it wins, so nothing has to be typed twice.
   */
  dimensions?: string;
  /** "Plaster, gold leaf, pigment" */
  materials?: string;
  media: MediaRef[];
  /** Which media id is the cover. Falls back to the first image. */
  coverId?: string;
  /** Ascending. Lower sorts first in the shop grid. */
  order: number;
  /** ISO date, set by the studio on create. */
  createdAt: string;
};

export type Catalog = {
  /** Bumped when the shape changes so a stored catalog can be migrated. */
  version: 1;
  pieces: Piece[];
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Price bands. Used by the Special Request form and as studio hints, so the two
// never drift apart. Real range: $500 small pottery to $10k on-site wall.
// ---------------------------------------------------------------------------

export type PriceBand = {
  id: string;
  label: string;
  min: number;
  max: number | null;
  /** What typically lands in this band, shown under the label. */
  note: string;
};

export const PRICE_BANDS: PriceBand[] = [
  { id: "band-500", label: "$500 – $1,500", min: 500, max: 1500, note: "Small pottery and tabletop pieces" },
  { id: "band-1500", label: "$1,500 – $4,000", min: 1500, max: 4000, note: "Sculpture and mid-scale relief panels" },
  { id: "band-4000", label: "$4,000 – $10,000", min: 4000, max: 10000, note: "Large wall relief, gold leaf work" },
  { id: "band-10000", label: "$10,000+", min: 10000, max: null, note: "On-site architectural wall installation" },
];

export const CATEGORY_LABELS: Record<PieceCategory, string> = {
  "wall-relief": "Wall Relief",
  sculpture: "Sculpture",
  pottery: "Pottery",
  commission: "Commission",
};

export const STATUS_LABELS: Record<PieceStatus, string> = {
  available: "Available",
  sold: "Sold",
  reserved: "Reserved",
  draft: "Draft",
};

export const UNIT_LABELS: Record<SizeUnit, string> = {
  cm: "centimetres",
  in: "inches",
  m: "metres",
};

/** Short form, for printing after a number. */
export const UNIT_SUFFIX: Record<SizeUnit, string> = { cm: "cm", in: "in", m: "m" };

// ---------------------------------------------------------------------------
// Helpers — shared so the shop, the studio and the build script all agree.
// ---------------------------------------------------------------------------

export function formatPrice(price: number | null): string {
  if (price == null) return "Price on request";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(price);
}

export function coverOf(piece: Piece): MediaRef | undefined {
  if (piece.coverId) {
    const hit = piece.media.find(m => m.id === piece.coverId);
    if (hit) return hit;
  }
  return piece.media.find(m => m.kind === "image") || piece.media[0];
}

/** Alt text always resolves to something: her caption, else the piece title. */
export function altOf(media: MediaRef | undefined, piece: Piece): string {
  return media?.caption?.trim() || piece.title;
}

const TO_CM: Record<SizeUnit, number> = { cm: 1, in: 2.54, m: 100 };

/** Normalised to centimetres so tiers and proportions can be compared. */
export function toCm(value: number, unit: SizeUnit): number {
  return value * TO_CM[unit];
}

/** The piece's largest real measurement in cm, or null if it has no numbers. */
export function largestDimensionCm(size: Size | undefined): number | null {
  if (!size) return null;
  const values = [size.height, size.length, size.depth].filter(
    (n): n is number => typeof n === "number" && n > 0,
  );
  if (!values.length) return null;
  return toCm(Math.max(...values), size.unit);
}

/**
 * The size as words. Generated from `size` when it exists so the studio never
 * asks for the same measurements twice, otherwise whatever free text was saved.
 */
export function formatSize(piece: Piece): string | null {
  const s = piece.size;
  if (!s) return piece.dimensions || null;
  const parts: string[] = [];
  if (s.height) parts.push(`H ${trim(s.height)}`);
  if (s.length) parts.push(`W ${trim(s.length)}`);
  if (s.depth) parts.push(`D ${trim(s.depth)}`);
  if (!parts.length) return piece.dimensions || null;
  return `${parts.join(" × ")} ${UNIT_SUFFIX[s.unit]}`;
}

function trim(n: number): string {
  // 11 not 11.0, but 11.5 keeps its half.
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Public shop hides drafts. The studio shows everything. */
export function publicPieces(catalog: Catalog): Piece[] {
  return catalog.pieces
    .filter(p => p.status !== "draft")
    .sort((a, b) => a.order - b.order);
}
