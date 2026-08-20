import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { loadCatalog, resolveMedia } from "../lib/catalog-store";
import {
  coverOf,
  formatPrice,
  CATEGORY_LABELS,
  STATUS_LABELS,
  type Catalog,
  type MediaRef,
} from "../lib/catalog";
import "./PieceDetail.css";

export default function PieceDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [mediaSrcs, setMediaSrcs] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCatalog().then(c => {
      if (!cancelled) setCatalog(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const piece = useMemo(() => catalog?.pieces.find(p => p.slug === slug), [catalog, slug]);

  // Cover first, then the rest of the piece's media in stored order.
  const orderedMedia: MediaRef[] = useMemo(() => {
    if (!piece) return [];
    const cover = coverOf(piece);
    if (!cover) return piece.media;
    return [cover, ...piece.media.filter(m => m.id !== cover.id)];
  }, [piece]);

  useEffect(() => {
    if (!piece) return;
    setActiveId(orderedMedia[0]?.id ?? null);
    setMediaSrcs({});
    let cancelled = false;
    orderedMedia.forEach(m => {
      resolveMedia(m).then(url => {
        if (!cancelled) setMediaSrcs(prev => ({ ...prev, [m.id]: url }));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [piece, orderedMedia]);

  if (catalog && !piece) {
    return (
      <main className="piece-detail piece-detail--empty">
        <p className="piece-detail__eyebrow">Not here</p>
        <h1 className="piece-detail__empty-title">This piece isn't in the shop.</h1>
        <Link to="/shop" className="piece-detail__back">
          &larr; Back to the shop
        </Link>
      </main>
    );
  }

  if (!piece) {
    return (
      <main className="piece-detail piece-detail--empty">
        <p className="piece-detail__status">Loading…</p>
      </main>
    );
  }

  const active = orderedMedia.find(m => m.id === activeId) ?? orderedMedia[0];
  const activeSrc = active ? mediaSrcs[active.id] : "";
  const unavailable = piece.status === "sold" || piece.status === "reserved";

  const mailSubject = unavailable
    ? `Enquiry: something like "${piece.title}"`
    : `Enquiry: "${piece.title}" (${formatPrice(piece.price)})`;
  const mailBody = unavailable
    ? `Hi,\n\nI'm interested in something similar to "${piece.title}" (${formatPrice(piece.price)}), which I understand is currently ${STATUS_LABELS[piece.status].toLowerCase()}. Could you tell me about a comparable commission?\n\n`
    : `Hi,\n\nI'd like to ask about "${piece.title}", listed at ${formatPrice(piece.price)}.\n\n`;
  const mailHref = `mailto:hello@dotdesigns.ca?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`;

  return (
    <main className="piece-detail">
      <Link to="/shop" className="piece-detail__back">
        &larr; Back to the shop
      </Link>

      <div className="piece-detail__layout">
        <div className="piece-detail__media">
          <div className="piece-detail__stage">
            {active && activeSrc ? (
              active.kind === "video" ? (
                <video className="piece-detail__stage-media" src={activeSrc} controls muted playsInline />
              ) : (
                <img className="piece-detail__stage-media" src={activeSrc} alt={active.alt || piece.title} />
              )
            ) : (
              <div className="piece-detail__placeholder" aria-hidden="true" />
            )}
          </div>

          {orderedMedia.length > 1 && (
            <div className="piece-detail__thumbs">
              {orderedMedia.map(m => (
                <button
                  key={m.id}
                  type="button"
                  className={`piece-detail__thumb${m.id === activeId ? " is-active" : ""}`}
                  onClick={() => setActiveId(m.id)}
                  aria-label={m.alt || piece.title}
                  aria-current={m.id === activeId}
                >
                  {mediaSrcs[m.id] ? (
                    m.kind === "video" ? (
                      <video className="piece-detail__thumb-media" src={mediaSrcs[m.id]} muted />
                    ) : (
                      <img className="piece-detail__thumb-media" src={mediaSrcs[m.id]} alt="" loading="lazy" />
                    )
                  ) : (
                    <span className="piece-detail__thumb-placeholder" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="piece-detail__info">
          <p className="piece-detail__eyebrow">
            {CATEGORY_LABELS[piece.category]}
            {piece.year ? ` · ${piece.year}` : ""}
          </p>
          <h1 className="piece-detail__title">{piece.title}</h1>
          {piece.status !== "available" && (
            <p className="piece-detail__pill">{STATUS_LABELS[piece.status]}</p>
          )}
          <p className="piece-detail__price">{formatPrice(piece.price)}</p>
          <p className="piece-detail__description">{piece.description}</p>

          {(piece.dimensions || piece.materials) && (
            <dl className="piece-detail__specs">
              {piece.dimensions && (
                <div className="piece-detail__spec">
                  <dt>Dimensions</dt>
                  <dd>{piece.dimensions}</dd>
                </div>
              )}
              {piece.materials && (
                <div className="piece-detail__spec">
                  <dt>Materials</dt>
                  <dd>{piece.materials}</dd>
                </div>
              )}
            </dl>
          )}

          <div className="piece-detail__action">
            <a className="piece-detail__enquire" href={mailHref}>
              {unavailable ? "Ask about a similar piece" : "Enquire about this piece"}
            </a>
            {/* Buy-now goes here once Stripe Checkout is wired up. Until then
                every path — available or not — hands off to email on purpose. */}
          </div>
        </div>
      </div>
    </main>
  );
}
