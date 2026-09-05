import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { loadCatalog, resolveMedia } from "../lib/catalog-store";
import { sendInquiry, looksLikeEmail, CONTACT_EMAIL } from "../lib/inquiry";
import { loadInventory, type StockEntry } from "../lib/inventory";
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
import SiteChrome from "../components/SiteChrome.tsx";
import ScaleFigure, { scaleNote } from "../components/ScaleFigure";
import "./PieceDetail.css";

type SendState = "idle" | "sending" | "sent" | "failed";
type BuyState = "idle" | "sending" | "failed";

export default function PieceDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stock, setStock] = useState<StockEntry | undefined>(undefined);
  const trackRef = useRef<HTMLDivElement>(null);
  // Raised while a dot or thumb is animating the track. Without it the
  // observer below reports every slide the smooth scroll flies past, and the
  // caption flashes through the ones you didn't ask for.
  const seeking = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadCatalog()
      .then(c => {
        if (!cancelled) setCatalog(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadInventory().then(inventory => {
      if (!cancelled) setStock(inventory[slug ?? ""]);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Arriving from the grid, which restores its own scroll position on the way
  // back — without this you'd land halfway down the piece page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

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
  }, [piece, orderedMedia]);

  // The carousel is the same strip at every width — full-bleed and swiped on a
  // phone, the left column's stage on a desktop. Whichever slide is centred is
  // the active one, so the caption under it and the thumbs below always agree
  // with what's on screen. activeId stays the single source of truth; the strip
  // only reports into it.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || orderedMedia.length < 2) return;
    const slides = Array.from(track.children) as HTMLElement[];
    const observer = new IntersectionObserver(
      entries => {
        if (seeking.current) return;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.mediaId;
          if (id) setActiveId(id);
        }
      },
      { root: track, threshold: 0.6 },
    );
    slides.forEach(slide => observer.observe(slide));
    return () => observer.disconnect();
  }, [orderedMedia]);

  const showSlide = useCallback(
    (index: number) => {
      const track = trackRef.current;
      if (!track) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.clearTimeout(seeking.current);
      // Long enough to cover a smooth scroll across the whole strip. If the
      // browser never finishes one, the worst case is that the dots stop
      // following a swipe for half a second.
      seeking.current = window.setTimeout(() => {
        seeking.current = 0;
      }, 600);
      track.scrollTo({ left: index * track.clientWidth, behavior: still ? "auto" : "smooth" });
      setActiveId(orderedMedia[index]?.id ?? null);
    },
    [orderedMedia],
  );

  // Enquiry form state. Prefilled once per piece, not on every render.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendError, setSendError] = useState("");
  const [buyState, setBuyState] = useState<BuyState>("idle");
  const [buyError, setBuyError] = useState("");

  // The sheet is the live stock number and wins over the catalog's own status
  // whenever there's an entry for this slug — same rule as the shop grid.
  const soldOut = stock ? stock.soldOut : piece?.status === "sold";
  // What to show is not the same question as what we can charge. The sheet's
  // price may be present-but-unparseable (null = "not for sale", per
  // inventory.ts) — that must block the button even though the catalog still
  // has an old price to display.
  const displayPrice = stock?.price ?? piece?.price ?? null;
  // /api/checkout reads the sheet row to price and decrement stock, so a
  // piece with no sheet entry (or an unpriced one, or a sold-out one) is
  // never purchasable — the Buy button stays disabled for all three.
  const canBuy = !!stock && !stock.soldOut && stock.price != null;
  const lowStock = !!stock && !stock.soldOut && stock.quantity > 0 && stock.quantity <= 2;

  // Whether the visitor has touched the message box — once they have, the
  // sold-out/available copy swap below leaves their text alone.
  const [messageTouched, setMessageTouched] = useState(false);

  useEffect(() => {
    if (!piece) return;
    setName("");
    setEmail("");
    setSendState("idle");
    setSendError("");
    setBuyState("idle");
    setBuyError("");
    setMessageTouched(false);
  }, [piece]);

  useEffect(() => {
    if (!piece || messageTouched) return;
    const unavailable = soldOut || piece.status === "reserved";
    setMessage(
      unavailable
        ? `Hi, I'm interested in something similar to "${piece.title}". Could you tell me about a comparable commission?`
        : `Hi, I'd like to ask about "${piece.title}".`,
    );
    // This re-runs once the inventory fetch resolves and soldOut flips from
    // its initial guess — as long as the visitor hasn't typed anything yet,
    // the copy corrects itself instead of drifting from the heading below.
  }, [piece, soldOut, messageTouched]);

  async function handleBuy() {
    if (!piece || !canBuy) return;
    setBuyState("sending");
    setBuyError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: piece.slug }),
      });
      const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !body?.url) {
        setBuyState("failed");
        setBuyError(body?.error || "Couldn't start checkout. Please try again.");
        return;
      }
      window.location.href = body.url;
    } catch {
      setBuyState("failed");
      setBuyError("Couldn't reach checkout. Check your connection and try again.");
    }
  }

  if (catalog && !piece) {
    return (
      <SiteChrome className="pd pd--empty">
        <p className="pd__eyebrow">Not here</p>
        <h1 className="pd__empty-title">This piece isn't in the shop.</h1>
        <Link to="/shop" className="pd__back">
          &larr;&nbsp; Back to the shop
        </Link>
      </SiteChrome>
    );
  }

  if (!piece) {
    return (
      <SiteChrome className="pd pd--empty">
        <p className="pd__status">Loading…</p>
      </SiteChrome>
    );
  }

  const active = orderedMedia.find(m => m.id === activeId) ?? orderedMedia[0];
  const size = formatSize(piece);
  const scale = scaleNote(piece.size);
  const statusPill = soldOut ? "Sold out" : piece.status !== "available" ? STATUS_LABELS[piece.status] : null;

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
    <SiteChrome className="pd" footerGap>
      <Link to="/shop" className="pd__back">
        &larr;&nbsp; Back to the shop
      </Link>

      <div className="pd__layout">
        <div className="pd__media">
          <div className="pd__track" ref={trackRef}>
            {orderedMedia.length === 0 ? (
              <div className="pd__slide">
                <div className="pd__placeholder">
                  <span>Photograph coming</span>
                </div>
              </div>
            ) : (
              orderedMedia.map((m, i) => {
                const src = resolveMedia(m);
                return (
                  <div className="pd__slide" key={m.id} data-media-id={m.id}>
                    {src ? (
                      m.kind === "video" ? (
                        <video className="pd__slide-media" src={src} controls muted playsInline />
                      ) : (
                        <img
                          className="pd__slide-media"
                          src={src}
                          alt={altOf(m, piece)}
                          width={m.width}
                          height={m.height}
                          loading={i === 0 ? "eager" : "lazy"}
                          decoding="async"
                        />
                      )
                    ) : (
                      <div className="pd__placeholder">
                        <span>Photograph coming</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {orderedMedia.length > 1 && (
            <div className="pd__dots" aria-label="Photographs">
              {orderedMedia.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  className={`pd__dot${m.id === active?.id ? " is-active" : ""}`}
                  aria-current={m.id === active?.id}
                  aria-label={`Photograph ${i + 1} of ${orderedMedia.length}`}
                  onClick={() => showSlide(i)}
                />
              ))}
            </div>
          )}

          {active?.caption && <p className="pd__caption">{active.caption}</p>}

          {orderedMedia.length > 1 && (
            <div className="pd__thumbs">
              {orderedMedia.map((m, i) => {
                const src = resolveMedia(m);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`pd__thumb${m.id === active?.id ? " is-active" : ""}`}
                    onClick={() => showSlide(i)}
                    aria-label={altOf(m, piece)}
                    aria-current={m.id === active?.id}
                  >
                    {src ? (
                      m.kind === "video" ? (
                        <video className="pd__thumb-media" src={src} muted />
                      ) : (
                        <img className="pd__thumb-media" src={src} alt="" loading="lazy" decoding="async" />
                      )
                    ) : (
                      <span className="pd__thumb-placeholder" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="pd__info">
          <p className="pd__eyebrow">
            {CATEGORY_LABELS[piece.category]}
            {piece.year ? ` · ${piece.year}` : ""}
          </p>
          <h1 className="pd__title">{piece.title}</h1>

          <p className="pd__pricerow">
            <span className="pd__price">{formatPrice(displayPrice)}</span>
            {statusPill && <span className="pd__pill">{statusPill}</span>}
            {lowStock && (
              <span className="pd__pill pd__pill--gold">
                {stock!.quantity === 1 ? "Last one" : `${stock!.quantity} left`}
              </span>
            )}
          </p>

          {/* The one action, always in reach. On a desktop it sits under the
              price where you'd expect it; on a phone the CSS lifts it out of
              the flow and pins it above the home indicator. Which action it is
              depends on the piece: Buy when the stock ledger can actually price
              and sell it, otherwise straight to the enquiry — a piece with no
              ledger row is the normal case, and a dead button would read as a
              broken site. */}
          <div className="pd__bar">
            <div className="pd__bar-meta">
              <span className="pd__bar-label">{CATEGORY_LABELS[piece.category]}</span>
              <span className="pd__bar-price">{soldOut ? "Sold out" : formatPrice(displayPrice)}</span>
            </div>
            {canBuy ? (
              <button type="button" className="pd__buy" onClick={handleBuy} disabled={buyState === "sending"}>
                {buyState === "sending" ? "Redirecting…" : "Buy now"}
              </button>
            ) : (
              <a className="pd__buy pd__buy--quiet" href="#piece-enquire">
                {soldOut || piece.status === "reserved" ? "Ask about a similar piece" : "Enquire"}
              </a>
            )}
          </div>
          {buyState === "failed" && <p className="pd__error">{buyError}</p>}

          <p className="pd__description">{piece.description}</p>

          {(size || piece.materials) && (
            <dl className="pd__specs">
              {size && (
                <div className="pd__spec">
                  <dt>Dimensions</dt>
                  <dd>{size}</dd>
                </div>
              )}
              {piece.materials && (
                <div className="pd__spec">
                  <dt>Materials</dt>
                  <dd>{piece.materials}</dd>
                </div>
              )}
            </dl>
          )}

          {piece.size && (
            <section className="pd__scale">
              <p className="pd__eyebrow">To scale</p>
              <ScaleFigure size={piece.size} formatted={size} />
              {scale && <p className="pd__scale-note">{scale}</p>}
            </section>
          )}

          <div className="pd__action" id="piece-enquire">
            {sendState === "sent" ? (
              <p className="pd__sent">Sent. We'll get back to you at {email}.</p>
            ) : (
              <form className="pd__form" onSubmit={handleSubmit} noValidate>
                <h2 className="pd__form-title">
                  {soldOut || piece.status === "reserved"
                    ? "Ask about a similar piece"
                    : "Enquire about this piece"}
                </h2>

                {/* Honeypot: real visitors never see or fill this in. */}
                <label className="pd__honeypot" aria-hidden="true" tabIndex={-1}>
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

                <div className="pd__fields">
                  <label className="pd__field">
                    <span>Name</span>
                    <input type="text" value={name} onChange={e => setName(e.target.value)} required />
                  </label>
                  <label className="pd__field">
                    <span>Email</span>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                  </label>
                </div>
                <label className="pd__field">
                  <span>Message</span>
                  <textarea
                    value={message}
                    onChange={e => {
                      setMessage(e.target.value);
                      setMessageTouched(true);
                    }}
                    rows={4}
                    required
                  />
                </label>

                {sendState === "failed" && (
                  <p className="pd__error">
                    {sendError} Or <a href={`mailto:${CONTACT_EMAIL}`}>email {CONTACT_EMAIL} directly</a>.
                  </p>
                )}

                <button type="submit" className="pd__enquire" disabled={sendState === "sending"}>
                  {sendState === "sending" ? "Sending…" : "Send enquiry"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </SiteChrome>
  );
}
