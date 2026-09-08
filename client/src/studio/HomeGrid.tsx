import { altOf, coverOf, STATUS_LABELS, type Piece } from "../lib/catalog.ts";
import { resolveMedia } from "./seam.ts";

type Props = {
  pieces: Piece[];
  onOpen: (id: string) => void;
  /** Tiles stop opening and grow move arrows instead. */
  reordering?: boolean;
  onMove?: (id: string, direction: -1 | 1) => void;
};

// Her profile grid. Three across, squares, cover photo only — the details
// live one tap in.
export default function HomeGrid({ pieces, onOpen, reordering, onMove }: Props) {
  if (pieces.length === 0) {
    return (
      <p className="empty-note">
        Nothing posted yet. Tap New at the bottom to put up your first piece.
      </p>
    );
  }

  return (
    <div className="home-grid">
      {pieces.map((piece, i) => {
        const cover = coverOf(piece);
        const src = cover ? resolveMedia(cover) : "";
        const badge = piece.status === "available" ? null : STATUS_LABELS[piece.status];
        const title = piece.title || "Untitled piece";
        const face = (
          <>
            {src && cover?.kind === "video" ? (
              <video src={src} muted playsInline preload="metadata" />
            ) : src ? (
              <img src={src} alt={reordering ? "" : altOf(cover, piece)} loading="lazy" />
            ) : (
              <span className="home-tile-blank">{piece.title || "Untitled"}</span>
            )}
            {badge && <span className={`tile-badge tile-badge-${piece.status}`}>{badge}</span>}
          </>
        );

        // Reorder mode can't keep the button: the arrows have to live inside
        // the tile and a button can't hold buttons.
        if (reordering) {
          return (
            <div key={piece.id} className="home-tile home-tile-static">
              {face}
              <div className="tile-move">
                <button
                  type="button"
                  className="tile-move-btn"
                  disabled={i === 0}
                  onClick={() => onMove?.(piece.id, -1)}
                  aria-label={`Move ${title} earlier`}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      d="M15 5 8 12l7 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className="tile-move-btn"
                  disabled={i === pieces.length - 1}
                  onClick={() => onMove?.(piece.id, 1)}
                  aria-label={`Move ${title} later`}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      d="m9 5 7 7-7 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          );
        }

        return (
          <button
            key={piece.id}
            type="button"
            className="home-tile"
            onClick={() => onOpen(piece.id)}
          >
            {face}
          </button>
        );
      })}
    </div>
  );
}
