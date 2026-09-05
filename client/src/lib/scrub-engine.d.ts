// Type surface for the vanilla-JS scrub engine (scrub-engine.js).
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
   * `range` for the mobile variant. A portrait re-render of the same continuous
   * take reaches its doorway on a different frame, so the split fraction between
   * two sections sharing one clip is per-variant. Falls back to `range`.
   */
  rangeMobile?: [number, number];
  /** `settle` for the mobile variant. Falls back to `settle`. */
  settleMobile?: number;
  /** `scroll` for the mobile variant — thumb travel, not wheel travel. Falls back to `scroll`. */
  scrollMobile?: number;
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

/**
 * The keys a variant can differ on. The mobile block shadows the top-level ones
 * while the phone variant is live; everything derived from them is recomputed
 * when the 860px breakpoint is crossed, so a desktop window dragged narrow gets
 * the phone's pacing without a reload.
 */
export interface ScrollWorldTuning {
  diveScroll?: number;
  connScroll?: number;
  crossfade?: number;
  hold?: number;
  stepScale?: number;
  /**
   * Per-frame catch-up on the scrubbed time (default 0.18). Lower is smoother and
   * laggier, and on a phone decoder it means fewer seeks per flick.
   */
  lerp?: number;
  /** ms after the last scroll event before the snap magnet pulls (default 140). */
  magnetDelay?: number;
  /** Multiplier on the magnet's travel time (default 1). Above 1 = a gentler pull. */
  magnetScale?: number;
  /**
   * How many clips the loading gate waits on before `onReady`. Default: all of
   * them. Set it lower to reveal the page after the opening clips and stream the
   * rest in behind it — the remaining clips start loading once onReady has fired,
   * so they never compete with the gate's own fetches.
   */
  preloadGate?: number;
}

export interface ScrollWorldConfig extends ScrollWorldTuning {
  brand?: { name?: string; href?: string };
  hint?: string;
  nav?: boolean;
  atmosphere?: boolean;
  cta?: { label?: string; href?: string };
  sections: ScrollWorldSection[];
  connectors?: (string | null)[];
  connectorsMobile?: (string | null)[];
  /**
   * Overrides applied while the mobile variant is live (coarse pointer or a
   * viewport <= 860px). `hold` is the one that matters most: a phone's stops want
   * less thumb travel than a wheel's.
   */
  mobile?: ScrollWorldTuning;
  /**
   * Magnetic stations. Scrolling stays native and one to one; when the gesture
   * and its momentum stop, the page eases onto the nearest station so nobody is
   * left parked mid-flight or mid-dissolve. Keys step station to station.
   */
  snap?: boolean;
  /** Fetch every clip at mount instead of lazily near the viewport. */
  preload?: boolean | "all";
  /**
   * The right-hand route rail (a vertical track with a dot per scene). Defaults
   * to true; set false to drop it — it reads as a scrollbar and duplicates the
   * topbar nav.
   */
  route?: boolean;
  /** The hairline progress bar across the top of the viewport. Defaults to true. */
  progress?: boolean;
  /**
   * Clips settled (decodable or failed) out of the total the gate waits on — see
   * `preloadGate`, which is what `total` counts.
   */
  onProgress?: (settled: number, total: number) => void;
  /** Fires once every clip has settled — or immediately if there is nothing to load. */
  onReady?: () => void;
  /**
   * Opt-in idle auto-advance. After `delay` ms with no interaction, steps
   * station to station (via the same snap magnet a keypress uses) every
   * `dwell` ms, stopping at the last station. Any wheel/touch/key/pointer
   * input cancels it for the session. Off when omitted. Never runs under
   * prefers-reduced-motion. Armed once the film is ready to watch, not at
   * mount, so a host page's own loading gate doesn't eat into the delay.
   */
  autoScroll?: { delay?: number; dwell?: number };
}

/**
 * Returned by mountScrollWorld. `destroy()` removes every window listener the
 * engine installed and stops its timers and frame loops. A single-page app has
 * to call it on unmount: the listeners are global but the container isn't, so
 * skipping it leaves the snap magnet driving the scroll on the next route.
 * Safe to call more than once.
 */
export interface ScrollWorldHandle {
  destroy: () => void;
}

declare global {
  interface Window {
    mountScrollWorld?: (
      container: HTMLElement,
      config: ScrollWorldConfig,
    ) => ScrollWorldHandle | undefined;
  }
}
