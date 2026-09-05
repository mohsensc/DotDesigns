import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { CONTACT_EMAIL } from "../lib/inquiry";
import dotGold from "../assets/dot-gold.png";
import "./SiteChrome.css";

// ---------------------------------------------------------------------------
// The chrome every non-film route wears.
//
// The home page is the scroll film, and its topbar is built by the engine. This
// one is a React copy of that row — same insets, same pill metrics, same logo —
// so moving from / to /shop doesn't read as leaving the site. The one honest
// difference is the ground: the film's bar floats fully transparent over video,
// this one carries a charcoal blur so it stays readable over a page that
// scrolls under it.
//
// Contact lines are printed, not linked, apart from the email — same as the
// film's closing scene. www.dotdesigns.ca and the handle are the studio's own
// wording; nothing here invents a URL for them.
// ---------------------------------------------------------------------------

const CONSULT_HREF = `mailto:${CONTACT_EMAIL}`;
const CONSULT_LABEL = "Book a consultation";

export function SiteTopbar() {
  const { pathname } = useLocation();
  const onShop = pathname.startsWith("/shop");
  // Neither is current on the 404 or the checkout pages — don't claim one is.
  const onGallery = pathname === "/";

  return (
    <header className="chrome-top">
      <Link to="/" className="chrome-top__brand" aria-label="DOT Designs — home">
        <img className="chrome-top__logo" src={dotGold} alt="DOT Designs" />
      </Link>

      {/* The film's nav pill, with the two routes as its items. */}
      <nav className="chrome-top__nav" aria-label="Sections">
        <Link
          to="/"
          className={`chrome-top__navitem${onGallery ? " is-active" : ""}`}
          aria-current={onGallery ? "page" : undefined}
        >
          Gallery
        </Link>
        <Link
          to="/shop"
          className={`chrome-top__navitem${onShop ? " is-active" : ""}`}
          aria-current={onShop ? "page" : undefined}
        >
          Shop
        </Link>
      </nav>

      {/* Under 640 the nav pill is display:none and this takes its place, so the
          logo can stay the size it is in the film. Only ever one of the two is
          in the tree at a time — no duplicate "Gallery" for a screen reader. */}
      <Link to="/" className="chrome-top__ghost">
        Gallery
      </Link>

      {/* Short label on phones, where the full sentence would push the row past
          the screen. The accessible name stays the full one either way. */}
      <a className="chrome-top__cta" href={CONSULT_HREF} aria-label={CONSULT_LABEL}>
        <span className="chrome-top__cta-long">{CONSULT_LABEL}</span>
        <span className="chrome-top__cta-short">Consultation</span>
      </a>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="chrome-foot">
      <img className="chrome-foot__logo" src={dotGold} alt="DOT Designs" />
      <ul className="chrome-foot__lines">
        <li>www.dotdesigns.ca</li>
        <li>
          <a href={CONSULT_HREF}>{CONTACT_EMAIL}</a>
        </li>
        <li>@dotdesigns.ca</li>
      </ul>
      <p className="chrome-foot__place">Handcrafted in Toronto</p>
    </footer>
  );
}

type Props = {
  children: ReactNode;
  /** Extra class on the <main>, so each page keeps its own layout rules. */
  className?: string;
  /** Pages with a pinned bottom bar pad the footer out of its way. */
  footerGap?: boolean;
};

export default function SiteChrome({ children, className, footerGap }: Props) {
  return (
    <div className={`chrome${footerGap ? " chrome--footer-gap" : ""}`}>
      <SiteTopbar />
      <main className={className}>{children}</main>
      <SiteFooter />
    </div>
  );
}
