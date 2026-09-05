import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { coverOf, formatPrice, formatSize, altOf, CATEGORY_LABELS, STATUS_LABELS, type Piece } from "../lib/catalog";
import { resolveMedia } from "../lib/catalog-store";
import { loadInventory, type StockEntry } from "../lib/inventory";
import "./PieceCard.css";

export default function PieceCard({ piece }: { piece: Piece }) {
  const cover = coverOf(piece);
  const src = cover ? resolveMedia(cover) : "";
  const [stock, setStock] = useState<StockEntry | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadInventory().then(inventory => {
      if (!cancelled) setStock(inventory[piece.slug]);
    });
    return () => {
      cancelled = true;
    };
  }, [piece.slug]);

  // The sheet is the live stock number — it wins over the catalog's own
  // status whenever both are present. Only fall back to the catalog's status
  // when there's no sheet entry for this slug at all.
  const sold = stock ? stock.soldOut : piece.status !== "available";
  const statusLabel = stock?.soldOut ? "Sold" : STATUS_LABELS[piece.status];
  const price = stock?.price ?? piece.price;
  const lowStock = !!stock && !stock.soldOut && stock.quantity > 0 && stock.quantity <= 2;
  const size = formatSize(piece);

  return (
    <Link to={`/shop/${piece.slug}`} className={`piece-card${sold ? " piece-card--sold" : ""}`}>
      <div className="piece-card__media">
        {src ? (
          <img className="piece-card__img" src={src} alt={altOf(cover, piece)} loading="lazy" />
        ) : (
          // A piece with no photo yet.
          <div className="piece-card__placeholder">
            {!cover && <span className="piece-card__placeholder-note">Photograph coming</span>}
          </div>
        )}
        {sold && <span className="piece-card__status">{statusLabel}</span>}
      </div>
      <div className="piece-card__body">
        <h3 className="piece-card__title">{piece.title}</h3>
        <p className="piece-card__meta">
          {CATEGORY_LABELS[piece.category]}
          {piece.year ? ` · ${piece.year}` : ""}
        </p>
        <p className="piece-card__price">{formatPrice(price)}</p>
        {size && <p className="piece-card__size">{size}</p>}
        {lowStock && (
          <p className="piece-card__low-stock">{stock!.quantity === 1 ? "Last one" : `${stock!.quantity} left`}</p>
        )}
      </div>
    </Link>
  );
}
