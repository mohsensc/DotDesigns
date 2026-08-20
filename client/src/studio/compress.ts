// Photo compression on upload. This exists because raw 12MP phone photos
// going straight into IndexedDB will hit the browser storage quota after a
// dozen shots, and it fails in a way Hajar can't diagnose — a "why didn't my
// photo save" bug report with no clue attached. Shrinking and re-encoding on
// the way in avoids that entirely.

export type CompressResult = {
  blob: Blob;
  originalBytes: number;
  finalBytes: number;
};

const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.82;

/**
 * Resizes to a max long edge of 2000px and re-encodes as JPEG. Never
 * upscales. Falls back to the original file untouched if anything in the
 * pipeline fails (old Safari, a corrupt file, canvas taint) — a slightly
 * bigger photo beats a piece with no photo at all.
 */
export async function compressImage(file: File): Promise<CompressResult> {
  const originalBytes = file.size;
  try {
    const bitmap = await loadBitmap(file);
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { blob: file, originalBytes, finalBytes: originalBytes };
      ctx.drawImage(bitmap, 0, 0, width, height);

      const blob = await new Promise<Blob | null>(resolve =>
        canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
      );

      // A re-encode that comes out bigger than the source (small PNGs,
      // already-compressed JPEGs) isn't a win — keep the original then.
      if (!blob || blob.size >= originalBytes) {
        return { blob: file, originalBytes, finalBytes: originalBytes };
      }
      return { blob, originalBytes, finalBytes: blob.size };
    } finally {
      bitmap.close();
    }
  } catch {
    return { blob: file, originalBytes, finalBytes: originalBytes };
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    // Respects EXIF rotation so phone photos don't land sideways. Not every
    // browser supports the option; the catch below falls back.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

/** "4.2 MB" / "380 KB" — for the per-file saving line, not stored anywhere. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
