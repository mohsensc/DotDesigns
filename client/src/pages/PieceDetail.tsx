import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { loadCatalog, resolveMedia } from "../lib/catalog-store";
import { sendInquiry, looksLikeEmail, CONTACT_EMAIL } from "../lib/inquiry";
import { useDocumentTitle } from "../lib/use-document-title";
import {
  coverOf,
  formatPrice,
  formatSize,
  altOf,
  CATEGORY_LABELS,
  STATUS_LABELS,
  type Catalog,
  type MediaRef,
} from "../lib/catalog";
import ScaleFigure from "../components/ScaleFigure";
import "./PieceDetail.css";

type SendState = "idle" | "sending" | "sent" | "failed";

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

  useDocumentTitle(piece?.title);

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

  // Enquiry form state. Prefilled once per piece, not on every render.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendError, setSendError] = useState("");

  useEffect(() => {
    if (!piece) return;
    setName("");
    setEmail("");
    setSendState("idle");
    setSendError("");
    const unavailable = piece.status === "sold" || piece.status === "reserved";
    setMessage(
      unavailable
        ? `Hi, I'm interested in something similar to "${piece.title}". Could you tell me about a comparable commission?`
        : `Hi, I'd like to ask about "${piece.title}".`,
    );
  }, [piece]);

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
  const size = formatSize(piece);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!piece) return;
    if (!name.trim() || !looksLikeEmail(email) || !message.trim()) {
      setSendState("failed");
      setSendError("Fill in your name, a valid email, and a message.");
      return;
    }
    setSendState("sending");
    setSendError("");
    const result = await sendInquiry({
      kind: "piece",
      name: name.trim(),
      email: email.trim(),
      message: message.trim(),
      pieceTitle: piece.title,
      pieceSlug: piece.slug,
      website,
    });
    if (result.ok) {
      setSendState("sent");
    } else {
      setSendState("failed");
      setSendError(result.error);
    }
  }

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
                <img className="piece-detail__stage-media" src={activeSrc} alt={altOf(active, piece)} />
              )
            ) : (
              <div className="piece-detail__placeholder" aria-hidden="true" />
            )}
          </div>
          {active?.caption && <p className="piece-detail__caption">{active.caption}</p>}

          {orderedMedia.length > 1 && (
            <div className="piece-detail__thumbs">
              {orderedMedia.map(m => (
                <button
                  key={m.id}
                  type="button"
                  className={`piece-detail__thumb${m.id === activeId ? " is-active" : ""}`}
                  onClick={() => setActiveId(m.id)}
                  aria-label={altOf(m, piece)}
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

          {(size || piece.materials) && (
            <dl className="piece-detail__specs">
              {size && (
                <div className="piece-detail__spec">
                  <dt>Dimensions</dt>
                  <dd>{size}</dd>
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

          <ScaleFigure size={piece.size} formatted={size} />

          <div className="piece-detail__action">
            {sendState === "sent" ? (
              <p className="piece-detail__sent">
                Sent. We'll get back to you at {email}.
              </p>
            ) : (
              <form className="piece-detail__form" onSubmit={handleSubmit} noValidate>
                <h2 className="piece-detail__form-title">
                  {piece.status === "sold" || piece.status === "reserved"
                    ? "Ask about a similar piece"
                    : "Enquire about this piece"}
                </h2>

                {/* Honeypot: real visitors never see or fill this in. */}
                <label className="piece-detail__honeypot" aria-hidden="true" tabIndex={-1}>
                  Website
                  <input
                    type="text"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={e => setWebsite(e.target.value)}
                  />
                </label>

                <label className="piece-detail__field">
                  <span>Name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                  />
                </label>
                <label className="piece-detail__field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </label>
                <label className="piece-detail__field">
                  <span>Message</span>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    rows={4}
                    required
                  />
                </label>

                {sendState === "failed" && (
                  <p className="piece-detail__error">
                    {sendError} Or{" "}
                    <a href={`mailto:${CONTACT_EMAIL}`}>email {CONTACT_EMAIL} directly</a>.
                  </p>
                )}

                <button
                  type="submit"
                  className="piece-detail__enquire"
                  disabled={sendState === "sending"}
                >
                  {sendState === "sending" ? "Sending…" : "Send enquiry"}
                </button>
                {/* Buy-now goes here once Stripe Checkout is wired up. Until then
                    every path — available or not — hands off to an enquiry on purpose. */}
              </form>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
