import type { Catalog, MediaKind, MediaRef, Piece } from "../lib/catalog.ts";
import { compressImage } from "./compress.ts";
import { CatalogConflictError, deleteMedia, savePiece, uploadMedia } from "./seam.ts";

/**
 * A photo or video in the composer. Either it's already on the server (`ref`)
 * or it's a file she just picked (`file`) and hasn't been uploaded yet.
 */
export type MediaItem = {
  /** Stable while the composer is open. Not the MediaRef id. */
  id: string;
  kind: MediaKind;
  caption: string;
  ref?: MediaRef;
  file?: File;
  /** Object URL for the local preview. Revoked when the composer closes. */
  previewUrl?: string;
};

export type PublishPhase =
  | { name: "uploading"; done: number; total: number; fraction: number }
  | { name: "posting" };

type Args = {
  piece: Piece;
  items: MediaItem[];
  /** MediaItem id of the cover, not the MediaRef id — refs may not exist yet. */
  coverItemId?: string;
  quantity: number;
  notes: string;
  /** Photos she removed from a piece that already had them. */
  removed: MediaRef[];
  /** Read late: a retry after re-signing in is working off a newer catalog. */
  getExpectedUpdatedAt: () => string;
  /** Hand back each upload so a retry doesn't send the same photo twice. */
  onUploaded: (itemId: string, ref: MediaRef) => void;
  onPhase: (phase: PublishPhase) => void;
};

/**
 * Uploads whatever is new, then saves the piece. Throws StudioAuthError
 * straight through so the caller can drop to the lock screen with her work
 * still in memory; everything else comes back as a plain Error to show.
 */
export async function publishPiece(args: Args): Promise<Catalog> {
  const { piece, items, quantity, notes, removed, getExpectedUpdatedAt, onUploaded, onPhase } = args;

  const pending = items.filter(i => !i.ref && i.file);
  const refs = new Map<string, MediaRef>();
  for (const item of items) if (item.ref) refs.set(item.id, item.ref);

  let done = 0;
  for (const item of pending) {
    const file = item.file!;
    onPhase({ name: "uploading", done, total: pending.length, fraction: 0 });
    const blob = item.kind === "image" ? (await compressImage(file)).blob : file;
    const ref = await uploadMedia(blob, {
      pieceId: piece.id,
      filename: file.name,
      kind: item.kind,
      onProgress: fraction => onPhase({ name: "uploading", done, total: pending.length, fraction }),
    });
    refs.set(item.id, ref);
    onUploaded(item.id, ref);
    done++;
  }

  // Her captions win over whatever came back from the upload.
  const media: MediaRef[] = items
    .map(item => {
      const ref = refs.get(item.id);
      if (!ref) return null;
      const caption = item.caption.trim();
      return caption ? { ...ref, caption } : { ...ref, caption: undefined };
    })
    .filter((m): m is MediaRef => m !== null);

  const coverRef = args.coverItemId ? refs.get(args.coverItemId) : undefined;
  const saved: Piece = { ...piece, media, coverId: coverRef?.id };

  onPhase({ name: "posting" });
  let catalog: Catalog;
  try {
    catalog = await savePiece(saved, quantity, notes, getExpectedUpdatedAt());
  } catch (err) {
    // Someone saved on another device between her opening this and hitting
    // Share. Their catalog is the truth now; put her piece on top of it once.
    if (!(err instanceof CatalogConflictError)) throw err;
    catalog = await savePiece(saved, quantity, notes, err.catalog.updatedAt);
  }

  // Best effort — a photo she deleted that lingers in storage costs nothing
  // and isn't worth failing a post she already sees as done.
  for (const ref of removed) {
    try {
      await deleteMedia(ref);
    } catch {
      /* ignore */
    }
  }

  return catalog;
}
