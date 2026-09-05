import { altOf, coverOf, STATUS_LABELS, type Piece } from "../lib/catalog.ts";
import { resolveMedia } from "./seam.ts";

type Props = {
  pieces: Piece[];
  onOpen: (id: string) => void;
};

// Her profile grid. Three across, squares, cover photo only — the details
// live one tap in.
export default function HomeGrid({ pieces, onOpen }: Props) {
  if (pieces.length === 0) {
    return (
      <p className="empty-note">
        Nothing posted yet. Tap New at the bottom to put up your first piece.
      </p>
    );
  }

  return (
    <div className="home-grid">
      {pieces.map(piece => {
        const cover = coverOf(piece);
        const src = cover ? resolveMedia(cover) : "";
        const badge = piece.status === "available" ? null : STATUS_LABELS[piece.status];
        return (
          <button
            key={piece.id}
            type="button"
            className="home-tile"
            onClick={() => onOpen(piece.id)}
          >
            {src && cover?.kind === "video" ? (
              <video src={src} muted playsInline preload="metadata" />
            ) : src ? (
              <img src={src} alt={altOf(cover, piece)} loading="lazy" />
            ) : (
              <span className="home-tile-blank">{piece.title || "Untitled"}</span>
            )}
            {badge && <span className={`tile-badge tile-badge-${piece.status}`}>{badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
