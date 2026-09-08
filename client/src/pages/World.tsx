import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import type { ScrollWorldConfig } from "../lib/scrub-engine";
// Side-effect import: the engine assigns window.mountScrollWorld at import time.
// It has no ES exports and returns no destroy handle.
import "../lib/scrub-engine.js";
import "./World.css";
import dotGold from "../assets/dot-gold.png";
import AmbientAudio from "../components/AmbientAudio.tsx";

// ---------------------------------------------------------------------------
// Deck — per-section copy for the DOT Designs gallery flight.
//
// This is the REAL approved copy deck. The film is one continuous flight
// (architecture A, no connector clips) carrying five stops: Arrival -> The Hall
// -> The Wall -> The Studio -> Materials. Four clips cover them; atelier.mp4 is
// read twice over complementary `range` windows (see below). One further deck
// beat, the centrepiece figure, is preserved as a commented block inside
// `sections`, in the order it slots into the film, ready for its clip.
//
// brandLine is the accessible name of the logo lockup, which is this page's h1.
// deckCta holds the one call to action; the engine renders only its label/href,
// so those are
// referenced into CONFIG while contactLines are kept here as the source of
// truth for the closing contact block.
// ---------------------------------------------------------------------------

const brandLine = "Architectural sculptural wall art, handcrafted in Toronto.";

const deckCta = {
  label: "Book a complimentary consultation",
  // The request form, not a raw address link. That link does nothing visible on
  // a phone with nothing set up to handle it, or on a desktop reading messages
  // in a browser, so the loudest button on the site failed silently for those
  // visitors and the studio never heard about it. /shop/request posts to the
  // server and tells the visitor it worked, and it already asks for the brief,
  // the space and the timeline a consultation needs. The address still reads in
  // the footer, where a dead link is obvious rather than silent.
  href: "/shop/request",
  contactLines: ["www.dotdesigns.ca", "hello@dotdesigns.ca", "@dotdesigns.ca"],
};

const DECK: ScrollWorldConfig = {
  brand: { name: "DOT Designs", href: "#" },
  hint: "scroll to fly in",
  nav: true,
  atmosphere: true,
  crossfade: 0.08, // continuous take: seam dissolve width (vh), engine-global
  connectors: [], // architecture A — one continuous flight, no connector clips
  // The camera parks on each scene's settle frame for a stretch of that scene's
  // scroll range. Scrolling itself stays native and one to one; those parked
  // frames are simply magnetic, so a gesture that ends mid-flight or mid-dissolve
  // eases onto the nearest of them rather than staying there.
  hold: 0.26,
  snap: true,
  // Scroll itself is native and one to one; stepScale only paces the discrete
  // moves — an arrow key, a nav click — where a slower, cinematic glide reads as
  // deliberate rather than sluggish.
  stepScale: 4,
  // Nothing that reads as a scrollbar: neither the right-hand route rail (the
  // topbar nav already covers jumping between stops) nor the hairline progress
  // bar across the top.
  route: false,
  progress: false,
  // The whole film is fetched before the page is revealed (see the gate below):
  // no visitor should meet this site with the animation still missing.
  preload: true,
  // Idle auto-advance: nudge a visitor who's stopped scrolling forward through
  // the film rather than leaving them parked. Cancels itself permanently on
  // any real interaction; the engine arms the countdown once the film is
  // actually visible (see its onReady path), not at mount.
  // dwell is measured start-of-step to start-of-step, and a step is not quick:
  // stepScale 4 puts each tween at 2.2-4.2s, so 5.2s left barely 1.8s to read a
  // title and two lines, and the whole film self-finished in 26s. 10.5s leaves
  // ~6.5s parked on each station, which is the point of stopping there at all.
  autoScroll: { delay: 3000, dwell: 10500 },
  // Shorter than the deck CTA: this one sits in the topbar next to the nav, and
  // the full sentence is carried by the closing scene's button.
  cta: { label: "Book a consultation", href: deckCta.href },
  // The phone is a different film, not this one squeezed. Portrait renders, a
  // shorter hold (a thumb covers less ground than a wheel), a lazier lerp and a
  // coarser magnet — a finger's momentum tail is longer and lumpier than a
  // trackpad's, so pulling on it at desktop speed reads as the page fighting the
  // gesture. preloadGate 2 reveals the page once Arrival and The Hall are
  // decodable; the other two stream in behind it (see docs/site.md).
  mobile: {
    hold: 0.2,
    diveScroll: 1.05,
    crossfade: 0.1,
    stepScale: 3,
    lerp: 0.14,
    magnetDelay: 240,
    magnetScale: 1.35,
    preloadGate: 2,
  },
  sections: [
    {
      id: "arrival",
      label: "Arrival",
      still: "/world/arrival.webp",
      clip: "/world/vid/arrival.mp4",
      // Native 9:16 renders of the same take, served whenever the phone variant
      // is live. Missing files are survivable: the clip falls back to the still
      // and the still falls back to the landscape one, so the page runs before
      // the portrait chain has landed.
      stillMobile: "/world/arrival-m.webp",
      clipMobile: "/world/vid/arrival-m.mp4",
      accent: "#B19556",
      // The landing greeting, held while the camera is still outside the room.
      // Verbatim brand voice: "Where sculpture meets architecture" is Hajar's own
      // profile line, and the descriptor row is the brochure cover's. The light
      // beat below is a real deck headline, but it is the second thing you read,
      // not the doorway.
      intro: {
        eyebrow: "ARCHITECTURAL DESIGNER · TORONTO, CANADA",
        title: "Where Sculpture Meets Architecture",
        body: "Handcrafted wall sculpture for exceptional interiors. Every project begins with a blank surface and ends with a piece made for one room only.",
      },
      eyebrow: "ARCHITECTURAL SCULPTURAL ART",
      title: "Sculpted by Light",
      body: "Where surface, shadow, and light become one. Each piece is shaped by hand and finished for its room.",
    },
    {
      id: "gallery",
      label: "The Hall",
      still: "/world/gallery.webp",
      clip: "/world/vid/gallery.mp4",
      stillMobile: "/world/gallery-m.webp",
      clipMobile: "/world/vid/gallery-m.mp4",
      accent: "#F2EDE4",
      // gallery.mp4 spends its last ~3s gliding off toward the gold wave wall,
      // which is the NEXT scene's subject, so this stop rests well short of the
      // clip's end: 5.80s, on the plaster monolith with its cascade of black
      // cords, the room still opening up behind it.
      //
      // A paused, scrubbed video paints the keyframe at or before the requested
      // time and these clips carry one every 0.333s, so the picture here steps at
      // 5.667 and holds until 6.0. 5.80 sits comfortably inside that step rather
      // than on its edge.
      settle: 0.5824,
      // gallery-m parks at 8.25s, monolith left of centre against the gold wall.
      settleMobile: 0.8216,
      eyebrow: "THE WORK",
      title: "More Than a Wall",
      body: "Monumental relief panels, each shaped by hand and finished for the space it lives in.",
      // The shop is part of this site, not a place you get shunted to from the
      // topbar. The Hall is where a visitor is looking at the work, so it is
      // where the offer to buy belongs. Same-origin href: the engine turns it
      // into a route change rather than reloading the whole film.
      cta: { secondary: { label: "See what's available", href: "/shop" } },
    },

    // -- The Wall / The Studio: one clip, two stops ------------------------
    // atelier.mp4 is a single continuous 9.96s take that tracks the length of the
    // gold wave wall (0 to ~5.6s, blossom branches sliding past in parallax) and
    // only then passes through the doorway into the atelier (~5.6s on). Those are
    // two different rooms and two different stories, so they are two sections
    // reading the same file over complementary `range` windows. No new footage,
    // no re-encode, one fetch: the engine caches the blob by URL and gives each
    // section its own video element and its own slice of the timeline.
    //
    // The split at 0.56 is the last frame before the doorway appears, so The
    // Wall's arrival frame and The Studio's opening frame are the same frame and
    // the seam between them is invisible.
    {
      id: "goldwave",
      label: "The Wall",
      still: "/world/atelier.webp",
      clip: "/world/vid/atelier.mp4",
      stillMobile: "/world/atelier-m.webp",
      clipMobile: "/world/vid/atelier-m.mp4",
      range: [0, 0.56],
      // atelier-m is its own render, so its doorway lands on its own frame:
      // the white frame first enters at 5.625s, so the split sits at 5.50s.
      // This pair and The Studio below must move together or the seam opens.
      rangeMobile: [0, 0.5477],
      accent: "#B19556",
      scroll: 1.35,
      scrollMobile: 1.15,
      // The reserved SIGNATURE beat from the deck, now that the footage supports
      // it as its own stop. Matches brochure page 04, The Wave Wall.
      eyebrow: "SIGNATURE",
      title: "The Surface Shifts",
      body: "A rippling gold relief that changes as you move, the light traveling every fold with you.",
    },
    {
      id: "atelier",
      label: "The Studio",
      still: "/world/studio.jpg",
      clip: "/world/vid/atelier.mp4",
      stillMobile: "/world/studio-m.webp",
      clipMobile: "/world/vid/atelier-m.mp4",
      range: [0.56, 1],
      rangeMobile: [0.5477, 1],
      accent: "#8C6F4A",
      scroll: 1.35,
      scrollMobile: 1.15,
      // Rest with the artist at the relief (~9.3s), before the camera turns to
      // the worktable that hands off to the materials scene. The portrait cut
      // rests at 9.42s, mid keyframe step (GOP 4 on the -m encodes).
      settle: 0.86,
      settleMobile: 0.8631,
      eyebrow: "IN THE STUDIO",
      title: "Shaped by Hand",
      body: "Hajar Sarafan sculpts every piece herself in Toronto, working plaster and light for one room only.",
    },

    // -- RESERVED: the sixth beat -------------------------------------------
    // The centrepiece figure sits between The Hall and The Wall in the full cut.
    // Held verbatim; uncomment it once its clip lands.
    // {
    //   id: "figures",
    //   label: "The Figure",
    //   still: "/world/figures.webp",
    //   clip: "/world/vid/figures.mp4",
    //   accent: "#2B2B2B",
    //   eyebrow: "THE CENTREPIECE",
    //   title: "Figure in Drapery",
    //   body: "A sculpted figure caught in motion, backlit until shadow and light become one.",
    //   tags: ["Hand Sculpted", "High Relief", "Backlit"],
    // },
    // ----------------------------------------------------------------------

    {
      id: "materials",
      // Named for its subject, not its job: the topbar already carries the
      // designated CTA, so this stop does not need to advertise itself as the
      // contact page. The address still sits under the button below.
      label: "Materials",
      still: "/world/materials.webp",
      clip: "/world/vid/materials.mp4",
      stillMobile: "/world/materials-m.webp",
      clipMobile: "/world/vid/materials-m.mp4",
      accent: "#F2EDE4",
      scroll: 1.5,
      scrollMobile: 1.25,
      eyebrow: "THE FINISHES",
      title: "Let's Create Something Original",
      body: "Gold leaf, plaster, and patient hands, brought together into a piece that belongs only to your space.",
      // The closing section carries the deck CTA plus the contact address.
      // The consultation stays the primary ask; the secondary goes to the shop.
      // Both are same-origin, so the engine turns them into route changes rather
      // than reloading the whole film.
      cta: {
        primary: { label: deckCta.label, href: deckCta.href },
        secondary: { label: "Browse the pieces", href: "/shop" },
      },
    },
  ],
};

export default function World() {
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const revealed = useRef(false);
  const [ready, setReady] = useState(false);
  // The engine builds its own topbar; the Shop link is portalled into it once
  // it exists, so it participates in that flex row instead of floating over it.
  const [topbar, setTopbar] = useState<HTMLElement | null>(null);
  const [progress, setProgress] = useState(0);

  // The engine renders its own CTAs, so it can't hold a react-router <Link>. It
  // emits this instead for any same-origin href and honours preventDefault as
  // "handled" — so a shop CTA inside the film is a route change, and coming back
  // doesn't re-download 40MB behind the loading gate.
  useEffect(() => {
    const onNav = (e: Event) => {
      const href = (e as CustomEvent<{ href?: string }>).detail?.href;
      if (!href) return;
      e.preventDefault();
      navigate(href);
    };
    window.addEventListener("scrollworld:navigate", onNav);
    return () => window.removeEventListener("scrollworld:navigate", onNav);
  }, [navigate]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // The engine builds its DOM and installs global scroll/resize listeners
    // imperatively. React 18 StrictMode (dev) mounts effects twice; a dataset
    // flag makes the mount idempotent so we never build the world twice into
    // the same container. The cleanup below clears it again.
    if (container.dataset.swMounted === "true") return;
    if (typeof window.mountScrollWorld !== "function") return;
    container.dataset.swMounted = "true";

    // Hold the document still until the film is decodable, so nobody can start
    // the flight — via a restored scroll offset, a keypress, a stray wheel event
    // — before there are frames to scrub.
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    // Marks the document as "the film owns the scroll" — World.css hangs the
    // hidden-scrollbar rules off this so they don't reach the other routes.
    html.classList.add("dot-world");

    // Idempotent: onReady and the stall timer race, and either may fire twice
    // across a StrictMode remount.
    const reveal = () => {
      if (revealed.current) return;
      revealed.current = true;
      html.style.overflow = prevOverflow;
      window.scrollTo(0, 0);
      setReady(true);
    };

    // A stalled CDN must not lock the site out altogether. If the film has not
    // settled within 30s we reveal anyway; those scenes fall back to their stills
    // and keep loading in the background.
    const stall = window.setTimeout(reveal, 30000);

    const world = window.mountScrollWorld(container, {
      ...DECK,
      onProgress: (settled, total) => setProgress(total ? settled / total : 1),
      onReady: () => {
        window.clearTimeout(stall);
        reveal();
      },
    });
    setTopbar(container.querySelector<HTMLElement>(".sw-topbar"));

    // Routing to /shop unmounts this component but the engine's listeners live
    // on the window, so without this the snap magnet keeps pulling the shop's
    // scroll position onto a station from a page that isn't on screen any more.
    return () => {
      window.clearTimeout(stall);
      world?.destroy();
      // The gate may still be up if they left mid-preload; don't strand the
      // document with overflow hidden.
      html.style.overflow = prevOverflow;
      html.classList.remove("dot-world");
      setTopbar(null);
      revealed.current = false;
      delete container.dataset.swMounted;
    };
  }, []);

  return (
    <>
      {/* Both are portalled into the engine's own topbar rather than floated
          over it. For the Shop pill that makes it a real flex child, lining up
          with the nav and the CTA by itself instead of by hand-matched offsets.
          For the lockup it is about the accessibility tree: the topbar is the
          page's banner, and the brand belongs inside it. It stays fixed-position
          either way, so neither reparenting moves anything on screen. */}
      {topbar &&
        createPortal(
          <>
            <Link to="/shop" className="dot-shop">
              Shop
            </Link>
            {/* Real logo lockup, used untouched, above every engine layer. The
                supplied asset is a full lockup — mark + "Designs" + descriptor —
                so it IS the brand chrome; the engine's placeholder brand is
                reserved-but-hidden in World.css so the nav clears it.

                It is also the page's h1: the film's own headings are all h2 and
                this route has no other candidate, so without it the front door
                has nothing to orient from. The sentence rides on the img's alt
                rather than as drawn text — an aria-label on the old plain div
                was ignored outright, which is how the one line saying what the
                studio does reached nobody. */}
            <h1 className="dot-brand">
              <img
                className="dot-brand__logo"
                src={dotGold}
                alt={`DOT Designs: ${brandLine}`}
              />
            </h1>
          </>,
          topbar,
        )}
      {/* No landmark role here: the engine puts role="banner" on the topbar it
          builds and role="main" on the copy layer that carries the film's text
          and CTAs. Those are siblings inside this element, so marking the
          wrapper as main too would nest the banner inside main. */}
      <div ref={containerRef} className="dot-world" />
      <AmbientAudio />

      {/* Loading gate. The whole film is fetched before anything is shown, so the
          scroll animation is there from the first gesture rather than arriving
          scene by scene while the visitor is already moving. */}
      {!ready && (
        <div className="dot-loader" role="status" aria-live="polite">
          <img className="dot-loader__logo" src={dotGold} alt="DOT Designs" />
          <p className="dot-loader__line">Preparing the gallery</p>
          {/* The bar and the percentage tick several times a second. Inside a
              polite live region that queues "Preparing the gallery 12% … 34% …"
              as the first thing a screen reader meets on the site, and a polite
              queue won't interrupt itself. Keep them visual; the line above
              announces once. */}
          <div className="dot-loader__bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
          <p className="dot-loader__pct" aria-hidden="true">
            {Math.round(progress * 100)}%
          </p>
        </div>
      )}
    </>
  );
}
