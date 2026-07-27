import { useEffect, useRef, useState } from "react";
import type { ScrollWorldConfig } from "../lib/scrub-engine";
// Side-effect import: the engine assigns window.mountScrollWorld at import time.
// It has no ES exports and returns no destroy handle.
import "../lib/scrub-engine.js";
import "./World.css";
import dotGold from "../assets/dot-gold.png";

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
// brandLine feeds the logo overlay's accessible tagline. deckCta holds the one
// call to action; the engine renders only its label/href, so those are
// referenced into CONFIG while contactLines are kept here as the source of
// truth for the closing contact block.
// ---------------------------------------------------------------------------

const brandLine = "Architectural sculptural wall art, handcrafted in Toronto.";

const deckCta = {
  label: "Book a complimentary consultation",
  href: "mailto:hello@dotdesigns.ca",
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
  // Shorter than the deck CTA: this one sits in the topbar next to the nav, and
  // the full sentence is carried by the closing scene's button.
  cta: { label: "Book a consultation", href: deckCta.href },
  sections: [
    {
      id: "arrival",
      label: "Arrival",
      still: "/world/arrival.webp",
      clip: "/world/vid/arrival.mp4",
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
      eyebrow: "THE WORK",
      title: "More Than a Wall",
      body: "Monumental relief panels, each shaped by hand and finished for the space it lives in.",
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
      range: [0, 0.56],
      accent: "#B19556",
      scroll: 1.35,
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
      range: [0.56, 1],
      accent: "#8C6F4A",
      scroll: 1.35,
      // Rest with the artist at the relief (~9.3s), before the camera turns to
      // the worktable that hands off to the materials scene.
      settle: 0.86,
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
      accent: "#F2EDE4",
      scroll: 1.5,
      eyebrow: "THE FINISHES",
      title: "Let's Create Something Original",
      body: "Gold leaf, plaster, and patient hands, brought together into a piece that belongs only to your space.",
      // The closing section carries the deck CTA plus the contact address.
      cta: {
        primary: { label: deckCta.label, href: deckCta.href },
        secondary: { label: deckCta.contactLines[1], href: deckCta.href },
      },
    },
  ],
};

export default function World() {
  const containerRef = useRef<HTMLDivElement>(null);
  const revealed = useRef(false);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // The engine exposes no destroy handle and builds its DOM + installs global
    // scroll/resize listeners imperatively. React 18 StrictMode (dev) mounts
    // effects twice; a dataset flag makes the mount idempotent so we never
    // build the world twice into the same container.
    if (container.dataset.swMounted === "true") return;
    if (typeof window.mountScrollWorld !== "function") return;
    container.dataset.swMounted = "true";

    // Hold the document still until the film is decodable, so nobody can start
    // the flight — via a restored scroll offset, a keypress, a stray wheel event
    // — before there are frames to scrub.
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";

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

    window.mountScrollWorld(container, {
      ...DECK,
      onProgress: (settled, total) => setProgress(total ? settled / total : 1),
      onReady: () => {
        window.clearTimeout(stall);
        reveal();
      },
    });
    // No cleanup: the engine returns nothing to tear down. The mount-once guard
    // above is the intended safeguard per the engine's design.
  }, []);

  return (
    <>
      {/* Real logo lockup, used untouched, overlaid above every engine layer
          (engine topbar is z-index 50). The supplied asset is a full lockup —
          mark + "Designs" + descriptor — so it IS the brand chrome; the engine's
          placeholder brand is reserved-but-hidden in World.css so the nav clears
          it. See the brandLine note below re: why no second tagline is drawn. */}
      <div className="dot-brand" aria-label={`DOT Designs: ${brandLine}`}>
        <img className="dot-brand__logo" src={dotGold} alt="DOT Designs" />
      </div>
      <div ref={containerRef} className="dot-world" />

      {/* Loading gate. The whole film is fetched before anything is shown, so the
          scroll animation is there from the first gesture rather than arriving
          scene by scene while the visitor is already moving. */}
      {!ready && (
        <div className="dot-loader" role="status" aria-live="polite">
          <img className="dot-loader__logo" src={dotGold} alt="DOT Designs" />
          <p className="dot-loader__line">Preparing the gallery</p>
          <div className="dot-loader__bar">
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
          <p className="dot-loader__pct">{Math.round(progress * 100)}%</p>
        </div>
      )}
    </>
  );
}
