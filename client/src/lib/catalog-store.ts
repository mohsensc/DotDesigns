// ---------------------------------------------------------------------------
// Where the catalog lives.
//
// Right now: this browser. The catalog JSON goes in localStorage, uploaded
// photos and videos go in IndexedDB (localStorage would blow its ~5MB quota on
// the first photo). That means edits made in the studio stay on the machine
// that made them — they do NOT publish to the public shop. The studio UI has to
// say so, and Export exists so the file can actually be handed over.
//
// This whole file is the seam. Swapping in a real API + object storage means
// rewriting the functions below and nothing else; every caller already awaits.
// ---------------------------------------------------------------------------

import { DEMO_CATALOG, type Catalog, type MediaRef } from "./catalog";

const CATALOG_KEY = "dot.catalog.v1";
const DB_NAME = "dot-media";
const DB_STORE = "blobs";

// ---- catalog ---------------------------------------------------------------

export async function loadCatalog(): Promise<Catalog> {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (!raw) return DEMO_CATALOG;
    const parsed = JSON.parse(raw) as Catalog;
    // Anything not version 1 predates the shape these callers expect. Falling
    // back to the demo is better than handing a half-understood object onward.
    if (parsed.version !== 1 || !Array.isArray(parsed.pieces)) return DEMO_CATALOG;
    return parsed;
  } catch {
    return DEMO_CATALOG;
  }
}

export async function saveCatalog(catalog: Catalog): Promise<void> {
  const next: Catalog = { ...catalog, updatedAt: new Date().toISOString() };
  localStorage.setItem(CATALOG_KEY, JSON.stringify(next));
}

/** Back to the shipped demo pieces. Does not touch stored media blobs. */
export async function resetCatalog(): Promise<void> {
  localStorage.removeItem(CATALOG_KEY);
}

// ---- media -----------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(DB_STORE, mode).objectStore(DB_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export async function putMedia(key: string, blob: Blob): Promise<void> {
  await tx("readwrite", s => s.put(blob, key) as IDBRequest<IDBValidKey>);
}

export async function getMedia(key: string): Promise<Blob | undefined> {
  return tx<Blob | undefined>("readonly", s => s.get(key));
}

export async function deleteMedia(key: string): Promise<void> {
  await tx("readwrite", s => s.delete(key) as IDBRequest<undefined>);
}

// Object URLs are cached by key: a piece page can mount the same media several
// times, and revoking one instance would blank the others.
const urlCache = new Map<string, string>();

/**
 * The src to actually put in an <img>/<video>. Demo pieces carry a build URL;
 * uploads resolve to an object URL over the stored blob. Returns "" when a blob
 * has gone missing, so callers can render a placeholder rather than a broken icon.
 */
export async function resolveMedia(ref: MediaRef): Promise<string> {
  if (ref.src) return ref.src;
  if (!ref.blobKey) return "";
  const cached = urlCache.get(ref.blobKey);
  if (cached) return cached;
  const blob = await getMedia(ref.blobKey);
  if (!blob) return "";
  const url = URL.createObjectURL(blob);
  urlCache.set(ref.blobKey, url);
  return url;
}

// ---- handover --------------------------------------------------------------

/** Catalog JSON only. Uploaded media stays in this browser. */
export function exportCatalog(catalog: Catalog): string {
  return JSON.stringify(catalog, null, 2);
}

export async function importCatalog(json: string): Promise<Catalog> {
  const parsed = JSON.parse(json) as Catalog;
  if (parsed.version !== 1 || !Array.isArray(parsed.pieces)) {
    throw new Error("That file isn't a Dot Designs catalog.");
  }
  await saveCatalog(parsed);
  return parsed;
}
