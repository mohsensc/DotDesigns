import { useEffect, useState } from "react";
import { resolveMedia } from "../lib/catalog-store.ts";
import type { MediaRef } from "../lib/catalog.ts";

type Props = {
  media: MediaRef;
  alt: string;
};

// Resolves a MediaRef (build asset or IndexedDB blob) to a real src for
// display. Used anywhere the list view needs a small preview.
export default function MediaThumb({ media, alt }: Props) {
  const [src, setSrc] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    resolveMedia(media).then(url => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [media]);

  if (!src) return <div className="media-thumb-empty" />;
  if (media.kind === "video") return <video src={src} muted />;
  return <img src={src} alt={alt} />;
}
