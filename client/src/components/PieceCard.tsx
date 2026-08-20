import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { coverOf, formatPrice, CATEGORY_LABELS, STATUS_LABELS, type Piece } from "../lib/catalog";
import { resolveMedia } from "../lib/catalog-store";
import "./PieceCard.css";

export default function PieceCard({ piece }: { piece: Piece }) {
  const cover = coverOf(piece);
  const [src, setSrc] = useState("");

  // resolveMedia can hit IndexedDB, so it's always async — even for demo
  // pieces that resolve instantly. Guard against setting state after unmount.
  useEffect(() => {
    let cancelled = false;
    setSrc("");
    if (cover) {
      resolveMedia(cover).then(url => {
        if (!cancelled) setSrc(url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [cover]);

  const sold = piece.status !== "available";

  return (
    <Link to={`/shop/${piece.slug}`} className={`piece-card${sold ? " piece-card--sold" : ""}`}>
      <div className="piece-card__media">
        {src ? (
          <img className="piece-card__img" src={src} alt={cover?.alt || piece.title} loading="lazy" />
        ) : (
          // Two cases land here: a piece with no photo yet, and the brief moment
          // before an async resolve returns. Only the first gets a label — the
          // second would flash it.
          <div className="piece-card__placeholder">
            {!cover && <span className="piece-card__placeholder-note">Photograph coming</span>}
          </div>
        )}
        {sold && <span className="piece-card__status">{STATUS_LABELS[piece.status]}</span>}
      </div>
      <div className="piece-card__body">
        <h3 className="piece-card__title">{piece.title}</h3>
        <p className="piece-card__meta">
          {CATEGORY_LABELS[piece.category]}
          {piece.year ? ` · ${piece.year}` : ""}
        </p>
        <p className="piece-card__price">{formatPrice(piece.price)}</p>
      </div>
    </Link>
  );
}
