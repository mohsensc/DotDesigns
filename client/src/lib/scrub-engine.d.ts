// Type surface for the vanilla-JS scroll-world engine (scrub-engine.js).
//
// The engine is imported for its side effect only: at import time it assigns
// `window.mountScrollWorld`. It exposes no ES module exports and returns no
// destroy handle from mountScrollWorld (see World.tsx for the remount guard).
//
// This declaration file sits next to scrub-engine.js so `import
// "./scrub-engine.js"` type-resolves, and augments the global Window with the
// function the engine installs.

export interface ScrollWorldSection {
  id: string;
  label?: string;
  still?: string;
  stillMobile?: string;
  clip?: string;
  clipMobile?: string;
  accent?: string;
  scroll?: number;
  linger?: number;
  eyebrow?: string;
  title?: string;
  body?: string;
  tags?: string[];
  cta?: {
    primary?: { label: string; href?: string };
    secondary?: { label: string; href?: string };
  };
}

export interface ScrollWorldConfig {
  brand?: { name?: string; href?: string };
  diveScroll?: number;
  connScroll?: number;
  crossfade?: number;
  hint?: string;
  nav?: boolean;
  atmosphere?: boolean;
  cta?: { label?: string; href?: string };
  sections: ScrollWorldSection[];
  connectors?: (string | null)[];
  connectorsMobile?: (string | null)[];
}

declare global {
  interface Window {
    mountScrollWorld?: (
      container: HTMLElement,
      config: ScrollWorldConfig,
    ) => void;
  }
}
