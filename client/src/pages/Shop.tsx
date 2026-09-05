import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { loadCatalog } from "../lib/catalog-store";
import { publicPieces, CATEGORY_LABELS, type Catalog, type Piece, type PieceCategory } from "../lib/catalog";
import { useDocumentTitle } from "../lib/use-document-title";
import SiteChrome from "../components/SiteChrome.tsx";
import PieceCard from "../components/PieceCard.tsx";
import "./Shop.css";

type Filter = "all" | PieceCategory;

const CATEGORIES: PieceCategory[] = ["wall-relief", "sculpture", "pottery", "commission"];

// Where the grid was when you tapped a piece. Restored on the way back so a
// phone doesn't dump you at the top of a very long column of photographs.
// sessionStorage rather than a library: it dies with the tab, which is right.
const SCROLL_KEY = "dot-shop-scroll";

export default function Shop() {
  useDocumentTitle("Shop");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const restored = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // A failed fetch leaves the grid in its loading state rather than
    // throwing — the endpoint already falls back to the demo pieces, so this
    // only happens when the network is gone.
    loadCatalog()
      .then(c => {
        if (!cancelled) setCatalog(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Track the position as it happens rather than reading it on the way out.
  // By the time an unmount cleanup runs, React has already pulled the grid out
  // of the DOM, the document is a screen tall, and the browser has clamped
  // scrollY to nearly zero — so the cleanup would faithfully save the wrong
  // number. The listener only assigns a ref, so it costs nothing per frame.
  const lastY = useRef(0);
  useEffect(() => {
    // Every route in this app places its own scroll: the film jumps to the top
    // once the flight is decodable, a piece page starts at the top, and the grid
    // puts itself back where you left it (below). Chrome's own restoration lands
    // AFTER all of those and, because the document is short at the moment you
    // navigate away, it restores a clamped near-zero offset over the top of the
    // right answer. Hand it over once and don't hand it back — there is no route
    // here that wants the browser guessing.
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";

    const track = () => {
      lastY.current = window.scrollY;
    };
    track();
    window.addEventListener("scroll", track, { passive: true });
    return () => {
      window.removeEventListener("scroll", track);
      try {
        sessionStorage.setItem(SCROLL_KEY, String(lastY.current));
      } catch {
        // Private mode, or storage full. Losing the position is survivable.
      }
    };
  }, []);

  // Read during render, not in an effect. StrictMode runs the effect above,
  // tears it down and runs it again, and that simulated teardown writes the
  // fresh page's scrollY — zero — over the number we came back for. Reading it
  // here happens before any of that.
  const [entryScroll] = useState(() => {
    try {
      return Number(sessionStorage.getItem(SCROLL_KEY)) || 0;
    } catch {
      return 0;
    }
  });

  // Restore only once the grid actually has height — before the catalog lands
  // the document is a screen tall and any scrollTo clamps straight back to 0.
  useEffect(() => {
    if (!catalog || restored.current) return;
    restored.current = true;
    try {
      // Used up. A later plain reload of /shop should start at the top.
      sessionStorage.removeItem(SCROLL_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
    if (entryScroll <= 0) {
      // No saved position — a fresh arrival (from the film, the topbar, a
      // reload). React Router doesn't reset scroll on navigation, so without
      // this the grid opens wherever the previous route's scrollY happened to
      // be (e.g. parked at the film's last station).
      window.scrollTo(0, 0);
      return;
    }
    // The grid is committed by the time this runs and every image has a CSS
    // aspect box, so the document is already its full height — go straight
    // there. The second pass on the next frame covers a web font swapping in
    // and pushing a title onto another line.
    window.scrollTo(0, entryScroll);
    requestAnimationFrame(() => window.scrollTo(0, entryScroll));
  }, [catalog, entryScroll]);

  const pieces: Piece[] = catalog ? publicPieces(catalog) : [];
  const shown = filter === "all" ? pieces : pieces.filter(p => p.category === filter);

  return (
    <SiteChrome className="shop">
      <header className="shop__band">
        <img
          className="shop__band-img"
          src="/world/materials.webp"
          alt="Gold leaf, plaster and pigment on the studio worktable"
          decoding="async"
        />
        <div className="shop__band-scrim" aria-hidden="true" />
        <div className="shop__band-copy">
          <p className="shop__eyebrow">The Shop</p>
          <h1 className="shop__title">Work available now.</h1>
          <p className="shop__lede">
            Each piece is made by hand, one at a time. Sold work stays listed —
            it's the clearest record of what the studio actually makes.
          </p>
          <Link to="/" className="shop__back">
            &larr;&nbsp; Back to the gallery
          </Link>
        </div>
      </header>

      <nav className="shop__filters" aria-label="Filter by category">
        <button
          type="button"
          className={`shop__filter${filter === "all" ? " is-active" : ""}`}
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            type="button"
            className={`shop__filter${filter === cat ? " is-active" : ""}`}
            aria-pressed={filter === cat}
            onClick={() => setFilter(cat)}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </nav>

      {catalog === null ? (
        <p className="shop__status">Loading the catalog…</p>
      ) : shown.length === 0 ? (
        <p className="shop__status">Nothing in this category right now.</p>
      ) : (
        <div className="shop__grid">
          {shown.map((p, i) => (
            // The first row is above the fold on every width; letting it lazy-load
            // just means the visitor watches it arrive.
            <PieceCard key={p.id} piece={p} eager={i < 3} />
          ))}
        </div>
      )}

      <section className="shop__cta">
        <div className="shop__cta-head">
          <p className="shop__eyebrow">Don't see it</p>
          <h2 className="shop__cta-title">Have something else in mind?</h2>
        </div>
        <div className="shop__cta-body">
          <p className="shop__cta-lede">
            Most of what leaves the studio starts as a conversation — a wall, a room, a
            rough sense of scale. Tell us about it and we'll work out the rest.
          </p>
          <Link to="/shop/request" className="shop__cta-link">
            Start a special request
          </Link>
        </div>
      </section>
    </SiteChrome>
  );
}
