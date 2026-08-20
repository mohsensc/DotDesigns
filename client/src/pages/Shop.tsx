import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadCatalog } from "../lib/catalog-store";
import { publicPieces, CATEGORY_LABELS, type Catalog, type Piece, type PieceCategory } from "../lib/catalog";
import { useDocumentTitle } from "../lib/use-document-title";
import PieceCard from "../components/PieceCard.tsx";
import dotGold from "../assets/dot-gold.png";
import "./Shop.css";

type Filter = "all" | PieceCategory;

const CATEGORIES: PieceCategory[] = ["wall-relief", "sculpture", "pottery", "commission"];

export default function Shop() {
  useDocumentTitle("Shop");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let cancelled = false;
    loadCatalog().then(c => {
      if (!cancelled) setCatalog(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pieces: Piece[] = catalog ? publicPieces(catalog) : [];
  const shown = filter === "all" ? pieces : pieces.filter(p => p.category === filter);

  return (
    <main className="shop">
      <header className="shop__header">
        <Link to="/" className="shop__brand" aria-label="Dot Designs — home">
          <img src={dotGold} alt="Dot Designs" className="shop__brand-logo" />
        </Link>
        <Link to="/" className="shop__back">
          &larr; Back to the gallery
        </Link>
      </header>

      <section className="shop__intro">
        <p className="shop__eyebrow">The Shop</p>
        <h1 className="shop__title">Work available now.</h1>
        <p className="shop__lede">
          Each piece here is made by hand, one at a time. Sold work stays listed —
          it's the clearest record of what the studio actually makes.
        </p>
      </section>

      <nav className="shop__filters" aria-label="Filter by category">
        <button
          type="button"
          className={`shop__filter${filter === "all" ? " is-active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            type="button"
            className={`shop__filter${filter === cat ? " is-active" : ""}`}
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
          {shown.map(p => (
            <PieceCard key={p.id} piece={p} />
          ))}
        </div>
      )}

      <section className="shop__cta">
        <p className="shop__cta-eyebrow">Don't see it</p>
        <h2 className="shop__cta-title">Have something else in mind?</h2>
        <p className="shop__cta-lede">
          Most of what leaves the studio starts as a conversation — a wall, a room, a
          rough sense of scale. Tell us about it and we'll work out the rest.
        </p>
        <Link to="/shop/request" className="shop__cta-link">
          <span>Start a special request</span>
          <span className="shop__cta-arrow">&rarr;</span>
        </Link>
      </section>
    </main>
  );
}
