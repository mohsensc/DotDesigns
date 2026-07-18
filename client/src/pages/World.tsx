import { useEffect, useRef } from "react";
import type { ScrollWorldConfig } from "../lib/scrub-engine";
// Side-effect import: the engine assigns window.mountScrollWorld at import time.
// It has no ES exports and returns no destroy handle.
import "../lib/scrub-engine.js";
import "./World.css";
import dotGold from "../assets/dot-gold.png";

// ---------------------------------------------------------------------------
// Deck — per-section copy for the DOT Designs gallery flight.
//
// This is the REAL approved copy deck, wired verbatim. The film is the final
// 4-leg cut: Arrival -> The Hall -> The Studio -> Materials, one continuous
// flight (architecture A, no connector clips). Two further deck beats shot for
// a future 6-video expansion (the centrepiece figure, then the signature gold
// wave) are preserved as a commented block inside `sections` below, in the
// order they slot into the film, ready to uncomment when those clips land.
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

const CONFIG: ScrollWorldConfig = {
  brand: { name: "DOT Designs", href: "#" },
  hint: "scroll to fly in",
  nav: true,
  atmosphere: true,
  crossfade: 0.08, // continuous take: seam dissolve width (vh), engine-global
  connectors: [], // architecture A — one continuous flight, no connector clips
  cta: { label: deckCta.label, href: deckCta.href },
  sections: [
    {
      id: "arrival",
      label: "Arrival",
      still: "/world/arrival.webp",
      clip: "/world/vid/arrival.mp4",
      accent: "#B19556",
      eyebrow: "ARCHITECTURAL SCULPTURAL ART",
      title: "Sculpted by Light",
      body: "Hand-sculpted architectural wall art, created for one room only and never repeated.",
      tags: ["Toronto, Canada", "Bespoke"],
    },
    {
      id: "gallery",
      label: "The Hall",
      still: "/world/gallery.webp",
      clip: "/world/vid/gallery.mp4",
      accent: "#F2EDE4",
      eyebrow: "THE WORK",
      title: "More Than a Wall",
      body: "Monumental relief panels, each shaped by hand and finished for the space it lives in.",
      tags: ["Hand Sculpted", "Bas Relief", "High Relief"],
    },

    // -- RESERVED: future 6-video expansion of the film --------------------
    // These two deck beats sit between "The Hall" and "The Studio" in the full
    // 6-leg cut. Held verbatim; uncomment both (and add their clips + the
    // matching connectors) to grow the flight from 4 sections to 6.
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
    // {
    //   id: "goldwave",
    //   label: "Gold Wave",
    //   still: "/world/goldwave.webp",
    //   clip: "/world/vid/goldwave.mp4",
    //   accent: "#B19556",
    //   eyebrow: "SIGNATURE",
    //   title: "The Surface Shifts",
    //   body: "A rippling gold relief that changes as you move, the light traveling every fold with you.",
    //   tags: ["22K Satin Gold", "Curved Surface", "Integrated Lighting"],
    // },
    // ----------------------------------------------------------------------

    {
      id: "atelier",
      label: "The Studio",
      still: "/world/atelier.webp",
      clip: "/world/vid/atelier.mp4",
      accent: "#8C6F4A",
      scroll: 1.6,
      linger: 0.4,
      eyebrow: "IN THE STUDIO",
      title: "Shaped by Hand",
      body: "Hajar Sarafan sculpts every piece herself in Toronto, working plaster and light for one room only.",
      tags: ["No molds", "No mass production", "Original work"],
    },
    {
      id: "materials",
      label: "Materials",
      still: "/world/materials.webp",
      clip: "/world/vid/materials.mp4",
      accent: "#F2EDE4",
      scroll: 1.8,
      linger: 0.5,
      eyebrow: "THE FINISHES",
      title: "Let's Create Something Original",
      body: "Gold leaf, plaster, and patient hands, brought together into a piece that belongs only to your space.",
      tags: ["Plaster", "22K Satin Gold", "Venetian White"],
      // The closing section carries the deck CTA (engine renders it as the
      // primary button in this scene's copy block).
      cta: { primary: { label: deckCta.label, href: deckCta.href } },
    },
  ],
};

export default function World() {
  const containerRef = useRef<HTMLDivElement>(null);

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
    window.mountScrollWorld(container, CONFIG);
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
    </>
  );
}
