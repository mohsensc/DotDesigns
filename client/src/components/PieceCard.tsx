import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { coverOf, formatPrice, formatSize, altOf, CATEGORY_LABELS, STATUS_LABELS, type Piece } from "../lib/catalog";
import { resolveMedia } from "../lib/catalog-store";
import { loadInventory, type StockEntry } from "../lib/inventory";
import { scaleNote } from "./ScaleFigure";
import "./PieceCard.css";

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function PieceCard({ piece, eager }: { piece: Piece; eager?: boolean }) {
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
  const scale = scaleNote(piece.size);

  return (
    <Link to={`/shop/${piece.slug}`} className={`piece-card${sold ? " piece-card--sold" : ""}`}>
      <div className="piece-card__media">
        {src && cover?.kind === "video" ? (
          <video
            className="piece-card__img"
            src={src}
            width={cover?.width}
            height={cover?.height}
            muted
            playsInline
            loop
            // Only the above-the-fold cards play, and only when motion is
            // welcome. The rest show their first frame: autoplay makes the
            // browser fetch the whole clip whatever preload says.
            autoPlay={eager && !reducedMotion()}
            preload={eager ? "auto" : "metadata"}
            aria-label={altOf(cover, piece)}
          />
        ) : src ? (
          <img
            className="piece-card__img"
            src={src}
            alt={altOf(cover, piece)}
            // The catalog carries natural pixel size only when the studio knew
            // it. When it does, the browser gets the real ratio; either way the
            // CSS aspect box below has already reserved the space.
            width={cover?.width}
            height={cover?.height}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
          />
        ) : (
          // A piece with no photo yet.
          <div className="piece-card__placeholder">
            <span className="piece-card__placeholder-note">Photograph coming</span>
          </div>
        )}
        {sold && <span className="piece-card__status">{statusLabel}</span>}
      </div>

      <div className="piece-card__body">
        <p className="piece-card__meta">
          {CATEGORY_LABELS[piece.category]}
          {piece.year ? ` · ${piece.year}` : ""}
        </p>
        {/* h2, not h3: the grid has no intervening heading between the page's
            h1 and each card, so h3 skipped a level (Lighthouse's
            heading-order audit). */}
        <h2 className="piece-card__title">{piece.title}</h2>
        <span className="piece-card__rule" aria-hidden="true" />
        <p className="piece-card__line">
          <span className="piece-card__price">{formatPrice(price)}</span>
          {size && <span className="piece-card__size">{size}</span>}
        </p>
        {scale && <p className="piece-card__scale">{scale}</p>}
        {lowStock && (
          <p className="piece-card__low-stock">{stock!.quantity === 1 ? "Last one" : `${stock!.quantity} left`}</p>
        )}
      </div>
    </Link>
  );
}
