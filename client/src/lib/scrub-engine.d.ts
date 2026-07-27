// Type surface for the vanilla-JS scroll-world engine (scrub-engine.js).
//
// The engine is imported for its side effect only: at import time it assigns
// `window.mountScrollWorld`. It exposes no ES module exports and returns no
// destroy handle from mountScrollWorld (see World.tsx for the remount guard).
//
// This declaration file sits next to scrub-engine.js so `import
// "./scrub-engine.js"` type-resolves, and augments the global Window with the
// function the engine installs.

/** One copy block: a section's own copy, or its optional `intro`. */
export interface ScrollWorldCopy {
  eyebrow?: string;
  title?: string;
  body?: string;
  tags?: string[];
  cta?: {
    primary?: { label: string; href?: string };
    secondary?: { label: string; href?: string };
  };
}

export interface ScrollWorldSection extends ScrollWorldCopy {
  id: string;
  label?: string;
  still?: string;
  stillMobile?: string;
  clip?: string;
  clipMobile?: string;
  accent?: string;
  scroll?: number;
  linger?: number;
  /**
   * Slice of `clip` this section plays, as [start, end] fractions of the clip's
   * duration. Lets one continuous take be split across several sections without
   * re-encoding it; the blob is fetched once and shared. Defaults to [0, 1].
   */
  range?: [number, number];
  /**
   * The frame this scene comes to rest on, as a 0..1 position within its own
   * `range`. Defaults to 1 (the end). Set it below 1 when the clip's final beat
   * is the camera already gliding toward the next room: the flight then settles
   * here, holds while the copy is read, and only releases the remaining tail as
   * the visitor scrolls away.
   */
  settle?: number;
  /**
   * Second copy block for this section, shown while the scene is still on its
   * opening frame and retired as the flight starts. Lets the landing scene greet
   * before the section's own copy lands with the camera.
   */
  intro?: ScrollWorldCopy;
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
  /**
   * Trailing fraction (0..0.8) of each scene's scroll range where the clip parks
   * on its arrival frame instead of scrubbing. Creates the second resting frame
   * per scene and the window in which that scene's copy is held up.
   */
  hold?: number;
  /**
   * Station-to-station navigation. The only positions a visitor can rest at are
   * each scene's opening and arrival frames; everything between is crossed by an
   * animated tween, so a flight or a dissolve always completes.
   */
  snap?: boolean;
  /** Fetch every clip at mount instead of lazily near the viewport. */
  preload?: boolean | "all";
  /**
   * Multiplier on how long a step between stations takes. 1 is the default pace;
   * 3 runs the transitions at a third of that speed. Requires `snap`.
   */
  stepScale?: number;
  /**
   * The right-hand route rail (a vertical track with a dot per scene). Defaults
   * to true; set false to drop it — it reads as a scrollbar and duplicates the
   * topbar nav.
   */
  route?: boolean;
  /** Clips settled (decodable or failed) out of the total, for a loading gate. */
  onProgress?: (settled: number, total: number) => void;
  /** Fires once every clip has settled — or immediately if there is nothing to load. */
  onReady?: () => void;
}

declare global {
  interface Window {
    mountScrollWorld?: (
      container: HTMLElement,
      config: ScrollWorldConfig,
    ) => void;
  }
}
