// ---------------------------------------------------------------------------
// The one seam between the app and the catalog on the server.
//
// The catalog lives in Redis behind /api/catalog (public, drafts stripped) and
// /api/studio-catalog (session-gated, everything). Photos and video live in
// Vercel Blob and go there straight from the browser. Nothing is cached in
// localStorage or IndexedDB: when Hajar saves, the live site has it.
//
// Every write sends the updatedAt it loaded. If the server's has moved on it
// answers 409 and this throws CatalogConflictError carrying the fresh catalog,
// so the caller can reload and let her redo the edit instead of quietly
// clobbering whatever the other tab saved.
// ---------------------------------------------------------------------------

import { upload } from "@vercel/blob/client";
import type { Catalog, MediaKind, MediaRef, Piece } from "./catalog";

/** Any 401. The studio drops back to the lock screen when it sees this. */
export class StudioAuthError extends Error {
  constructor(message = "Signed out.") {
    super(message);
    this.name = "StudioAuthError";
  }
}

/** A 409. `catalog` is what the server actually has right now. */
export class CatalogConflictError extends Error {
  catalog: Catalog;
  constructor(message: string, catalog: Catalog) {
    super(message);
    this.name = "CatalogConflictError";
    this.catalog = catalog;
  }
}

type Payload = { catalog?: Catalog; error?: string };

async function readPayload(res: Response): Promise<Payload> {
  try {
    return (await res.json()) as Payload;
  } catch {
    return {};
  }
}

async function catalogFrom(res: Response): Promise<Catalog> {
  if (res.status === 401) throw new StudioAuthError();
  const body = await readPayload(res);
  if (res.status === 409) {
    throw new CatalogConflictError(
      body.error || "Someone saved before you.",
      body.catalog ?? { version: 1, pieces: [], updatedAt: "" },
    );
  }
  if (!res.ok) throw new Error(body.error || "Couldn't reach the catalog. Try again in a moment.");
  if (!body.catalog) throw new Error("The server sent back an empty catalog.");
  return body.catalog;
}

// ---- reads -----------------------------------------------------------------

/** Public shop. Drafts already removed, pieces already in order. */
export async function loadCatalog(): Promise<Catalog> {
  const res = await fetch("/api/catalog");
  return catalogFrom(res);
}

/** Studio. Drafts included. Throws StudioAuthError when the session is gone. */
export async function loadStudioCatalog(): Promise<Catalog> {
  const res = await fetch("/api/studio-catalog");
  return catalogFrom(res);
}

/** Price and stock for one slug, from the ledger the checkout charges against. */
export async function loadInventoryRow(slug: string): Promise<{ quantity: number; notes: string } | null> {
  const res = await fetch(`/api/studio-inventory?slug=${encodeURIComponent(slug)}`);
  if (res.status === 401) throw new StudioAuthError();
  if (!res.ok) throw new Error("Couldn't read the stock for that piece.");
  const body = (await res.json()) as { row?: { quantity?: number; notes?: string } | null };
  if (!body.row) return null;
  return { quantity: body.row.quantity ?? 0, notes: body.row.notes ?? "" };
}

// ---- writes ----------------------------------------------------------------

/** Saves the piece and its price/stock row in one request. */
export async function savePiece(
  piece: Piece,
  quantity: number,
  notes: string,
  expectedUpdatedAt: string,
): Promise<Catalog> {
  const res = await fetch("/api/studio-catalog", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ piece, quantity, notes, expectedUpdatedAt }),
  });
  return catalogFrom(res);
}

export async function deletePiece(id: string, expectedUpdatedAt: string): Promise<Catalog> {
  // Both in the query string and in the body: a DELETE body is legal but not
  // everything on the way there parses one.
  const query = `id=${encodeURIComponent(id)}&expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`;
  const res = await fetch(`/api/studio-catalog?${query}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedUpdatedAt }),
  });
  return catalogFrom(res);
}

export async function reorderPieces(order: string[], expectedUpdatedAt: string): Promise<Catalog> {
  const res = await fetch("/api/studio-catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order, expectedUpdatedAt }),
  });
  return catalogFrom(res);
}

// ---- media -----------------------------------------------------------------

/** Strip anything that would make an awkward blob path. The suffix keeps it unique. */
function safeName(filename: string): string {
  const cleaned = filename.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "");
  return cleaned || "file";
}

/**
 * Uploads straight from the browser to Vercel Blob. The file never passes
 * through a function, so a phone video isn't a 60MB request body — the function
 * only signs off on the upload.
 */
export async function uploadMedia(
  file: Blob,
  opts: { pieceId: string; filename: string; kind: MediaKind; onProgress?: (fraction: number) => void },
): Promise<MediaRef> {
  const result = await upload(`pieces/${opts.pieceId}/${safeName(opts.filename)}`, file, {
    access: "public",
    handleUploadUrl: "/api/studio-upload",
    contentType: file.type || undefined,
    onUploadProgress: opts.onProgress ? e => opts.onProgress!(e.percentage / 100) : undefined,
  });
  return {
    id: `m-${Math.random().toString(36).slice(2, 10)}`,
    kind: opts.kind,
    src: result.url,
  };
}

/**
 * Only for a file she removed before saving — deleting a piece takes its blobs
 * with it. Deleting needs the write token, so it goes through our own endpoint
 * rather than the blob client.
 */
export async function deleteMedia(ref: MediaRef): Promise<void> {
  if (!ref.src.startsWith("https://")) return;
  const res = await fetch("/api/studio-upload", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: ref.src }),
  });
  if (res.status === 401) throw new StudioAuthError();
  if (!res.ok) throw new Error("Couldn't delete that file.");
}

/** Kept as a function so callers read the same either side of the rewrite. */
export function resolveMedia(ref: MediaRef): string {
  return ref.src;
}
