import {
  altOf,
  CATEGORY_LABELS,
  coverOf,
  formatPrice,
  formatSize,
  STATUS_LABELS,
  type Piece,
} from "../lib/catalog.ts";
import ScaleFigure from "../components/ScaleFigure.tsx";
import { resolveMedia } from "./seam.ts";

type Props = {
  piece: Piece;
  onEdit: () => void;
};

// One piece, the way it reads on the shop: photos first, then the words.
export default function PieceScreen({ piece, onEdit }: Props) {
  const cover = coverOf(piece);
  // Cover leads, same as the public page, so what she sees here is what a
  // buyer sees.
  const ordered = cover ? [cover, ...piece.media.filter(m => m.id !== cover.id)] : piece.media;
  const size = formatSize(piece);

  return (
    <div className="piece-screen">
      {ordered.length > 0 ? (
        <div className="carousel" aria-label="Photos">
          {ordered.map(m => {
            const src = resolveMedia(m);
            return (
              <div className="carousel-slide" key={m.id}>
                {m.kind === "video" ? (
                  <video src={src} controls playsInline preload="metadata" />
                ) : (
                  <img src={src} alt={altOf(m, piece)} />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="carousel-empty">No photos yet</div>
      )}

      {ordered.length > 1 && (
        <p className="carousel-count">
          {ordered.length} photos — swipe to see the rest
        </p>
      )}

      <div className="piece-body">
        <div className="piece-body-head">
          <h2>{piece.title || "Untitled piece"}</h2>
          <span className={`status-pill status-${piece.status}`}>{STATUS_LABELS[piece.status]}</span>
        </div>

        <p className="piece-body-meta">
          {CATEGORY_LABELS[piece.category]}
          {piece.year ? ` · ${piece.year}` : ""} · {formatPrice(piece.price)}
        </p>

        {piece.blurb && <p className="piece-body-blurb">{piece.blurb}</p>}
        {piece.description && <p className="piece-body-text">{piece.description}</p>}

        {(size || piece.materials) && (
          <dl className="piece-facts">
            {size && (
              <>
                <dt>Size</dt>
                <dd>{size}</dd>
              </>
            )}
            {piece.materials && (
              <>
                <dt>Materials</dt>
                <dd>{piece.materials}</dd>
              </>
            )}
          </dl>
        )}

        <ScaleFigure size={piece.size} formatted={size} />

        <button type="button" className="btn btn-primary btn-block" onClick={onEdit}>
          Edit this piece
        </button>
      </div>
    </div>
  );
}
