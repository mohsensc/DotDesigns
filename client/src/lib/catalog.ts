// ---------------------------------------------------------------------------
// The catalog contract.
//
// One shape, two consumers: the public shop (/shop) reads it, the studio build
// writes it. Both import from here — if you change a type, change it once.
//
// Media is deliberately indirect. A MediaRef either points at a URL that ships
// with the build (the demo pieces) or at a blob the studio stashed in IndexedDB
// (anything Hajar uploads). The shop only ever needs `resolveMedia` to tell the
// difference, so swapping IndexedDB for real object storage later is one file.
// ---------------------------------------------------------------------------

export type MediaKind = "image" | "video";

export type MediaRef = {
  id: string;
  kind: MediaKind;
  /** Ships with the build. Set for demo pieces, absent for uploads. */
  src?: string;
  /** IndexedDB key. Set for uploads, absent for demo pieces. */
  blobKey?: string;
  alt?: string;
};

/** What the piece is. Drives filtering and the default price band. */
export type PieceCategory = "wall-relief" | "sculpture" | "pottery" | "commission";

/** Availability. `sold` still shows — sold work is the strongest proof there is. */
export type PieceStatus = "available" | "sold" | "reserved" | "draft";

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
  /** Free text: "48 × 36 in", "H 14 in". */
  dimensions?: string;
  /** "Plaster, gold leaf, pigment" */
  materials?: string;
  media: MediaRef[];
  /** Which media id is the cover. Falls back to media[0]. */
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
// Price bands. Used by the Special Request form and as studio presets, so the
// two never drift apart. Real range: $500 small pottery to $10k on-site wall.
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

// ---------------------------------------------------------------------------
// Helpers — shared so the shop and the studio format money and covers the same.
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

/** Public shop hides drafts. The studio shows everything. */
export function publicPieces(catalog: Catalog): Piece[] {
  return catalog.pieces
    .filter(p => p.status !== "draft")
    .sort((a, b) => a.order - b.order);
}

// ---------------------------------------------------------------------------
// Demo catalog.
//
// Lightweight on purpose: every cover reuses a still that already ships for the
// scroll film (client/public/world/), so the shop adds no image weight to the
// build at all. Real photography replaces these through the studio.
// ---------------------------------------------------------------------------

const img = (id: string, src: string, alt: string): MediaRef => ({ id, kind: "image", src, alt });

export const DEMO_CATALOG: Catalog = {
  version: 1,
  updatedAt: "2026-08-20T00:00:00.000Z",
  pieces: [
    {
      id: "p-wave-wall",
      slug: "the-wave-wall",
      title: "The Wave Wall",
      year: 2025,
      category: "commission",
      status: "available",
      price: 10000,
      blurb: "A rippling gold relief that changes as you move.",
      description:
        "Installed on site over four days, the wave wall is built up fold by fold in plaster and finished in genuine gold leaf. The relief is cut so that the light travels the surface with the viewer — the room is never quite the same twice.\n\nScale, fold depth, and leaf tone are set with the architect. Quoted per wall.",
      dimensions: "Sized to the wall",
      materials: "Plaster, 23k gold leaf",
      media: [img("m-wave-1", "/world/atelier.webp", "The gold wave wall, raking light along the folds")],
      coverId: "m-wave-1",
      order: 1,
      createdAt: "2026-01-14T00:00:00.000Z",
    },
    {
      id: "p-monolith",
      slug: "monolith-with-cords",
      title: "Monolith with Cords",
      year: 2025,
      category: "wall-relief",
      status: "available",
      price: 7400,
      blurb: "A plaster monolith with a cascade of black cords.",
      description:
        "A single plaster slab, hand-worked while green so the surface keeps the tool. A cascade of waxed black cord falls the full height, weighted at the ends, and moves a little when the room does.\n\nHangs on a French cleat, included.",
      dimensions: "84 × 40 in",
      materials: "Plaster, waxed cord, steel",
      media: [img("m-mono-1", "/world/gallery.webp", "Plaster monolith with black cords in the hall")],
      coverId: "m-mono-1",
      order: 2,
      createdAt: "2026-02-02T00:00:00.000Z",
    },
    {
      id: "p-sculpted-light",
      slug: "sculpted-by-light",
      title: "Sculpted by Light",
      year: 2024,
      category: "wall-relief",
      status: "sold",
      price: 6200,
      blurb: "High relief cut for a single raking light source.",
      description:
        "Built for one wall and one lamp. The relief is shallow at the edges and deepest at the centre, so at the right angle the whole panel reads as a single fold of cloth.\n\nSold — a close variation can be commissioned.",
      dimensions: "60 × 48 in",
      materials: "Plaster, pigment",
      media: [img("m-light-1", "/world/arrival.webp", "Relief panel lit from the side")],
      coverId: "m-light-1",
      order: 3,
      createdAt: "2025-11-20T00:00:00.000Z",
    },
    {
      id: "p-studio-vessel",
      slug: "studio-vessel-no-4",
      title: "Studio Vessel No. 4",
      year: 2026,
      category: "pottery",
      status: "available",
      price: 640,
      blurb: "Hand-built vessel, matte bone glaze.",
      description:
        "Coil-built and scraped back, then glazed in a matte bone white that pools slightly at the foot. Watertight. One of a short run, each a little different.",
      dimensions: "H 11 in, Ø 7 in",
      materials: "Stoneware, matte glaze",
      media: [img("m-vessel-1", "/world/materials.webp", "Matte white stoneware vessel")],
      coverId: "m-vessel-1",
      order: 4,
      createdAt: "2026-03-08T00:00:00.000Z",
    },
    {
      id: "p-small-bowl",
      slug: "ash-bowl",
      title: "Ash Bowl",
      year: 2026,
      category: "pottery",
      status: "available",
      price: 500,
      blurb: "Small wheel-thrown bowl in a grey ash glaze.",
      description: "Wheel-thrown, trimmed thin, finished in a grey ash glaze that breaks warm over the rim. Dishwasher safe, though it would rather you didn't.",
      dimensions: "H 4 in, Ø 9 in",
      materials: "Stoneware, ash glaze",
      media: [img("m-bowl-1", "/world/studio.jpg", "Grey ash-glazed bowl on the worktable")],
      coverId: "m-bowl-1",
      order: 5,
      createdAt: "2026-03-30T00:00:00.000Z",
    },
    {
      id: "p-figure-drapery",
      slug: "figure-in-drapery",
      title: "Figure in Drapery",
      year: 2025,
      category: "sculpture",
      status: "reserved",
      price: 4800,
      blurb: "A sculpted figure caught mid-motion, backlit.",
      description:
        "A half-scale figure worked in plaster over armature, the drapery pulled so it reads as movement from every side. Meant to be backlit — the shadow it throws is half the piece.\n\nCurrently reserved. Ask to be told if it frees up.",
      dimensions: "H 38 in",
      materials: "Plaster, steel armature",
      media: [img("m-fig-1", "/world/gallery.webp", "Sculpted figure in drapery, backlit")],
      coverId: "m-fig-1",
      order: 6,
      createdAt: "2025-09-12T00:00:00.000Z",
    },
  ],
};
