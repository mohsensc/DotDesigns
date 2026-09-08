/* ============================================================================
   portable scroll-scrubbed camera-flight engine
   ----------------------------------------------------------------------------
   Framework-agnostic. Vanilla JS, zero dependencies. It builds its own DOM and
   injects its own (namespaced) CSS into a container you give it, so it drops into
   plain HTML, Next.js (call from a ref/useEffect), Vue (onMounted), a server-
   rendered page, anything.

   USAGE
     mountScrollWorld(document.getElementById('world'), {
       brand: { name: 'Pearl & Co.', href: '#top' },
       diveScroll: 1.3,   // viewport-heights of scroll per dive clip
       connScroll: 0.9,   // ...per connector clip
       hint: 'scroll to fly in',
       nav: true,         // show the top section nav
       atmosphere: true,  // subtle gradient + drifting particles behind the clips
       sections: [
         { id, label, still, stillMobile, clip, clipMobile, accent,
           scroll: 1.6,   // optional per-section override of diveScroll — more scroll
                          // distance = a slower, longer dwell in this scene
           linger: 0.5,   // optional 0..1 — remaps time so the camera settles mid-scene
                          // (exactly where the copy peaks) and moves quicker at the
                          // edges. 0 = linear (default). Keep ≤ 0.6; 1 = full pause.
           eyebrow, title, body, tags:[…],
           cta:{ primary:{label,href}, secondary:{label,href} } }, // last section only
         …
       ],
       connectors: [clipUrl, …],          // length = sections.length - 1 (nulls allowed)
       connectorsMobile: [clipUrl, …],    // optional lighter connectors for phones (same length)

   MOBILE (the clipMobile/connectorsMobile variants are the opt-in mobile version;
   the rest of the phone handling below is always on)
     The engine is phone-aware out of the box: on a coarse-pointer / ≤860px viewport it
       - loads `clipMobile` / `connectorsMobile` when provided (encode these smaller +
         tighter-GOP — seek cost on a phone decoder is dominated by frames-from-keyframe,
         so a 720p, -g 4 file scrubs far smoother than the 1080p desktop master).
         Falls back to the desktop `clip` if no mobile variant is given.
       - uses `stillMobile` as the scene poster when provided (pair it with native 9:16
         clipMobile renders so the poster matches the portrait video's first frame instead
         of flashing from a landscape crop).
       - SWITCHES LIVE. Crossing 860px on a desktop resize swaps every scene's clip,
         poster, range, settle and pacing to the other variant, keeping the camera on
         the same fraction of the same scene so the picture doesn't jump. Debounced;
         a URL-bar height change never crosses the breakpoint and never triggers it.
     Per-variant config:
       mobile: { hold, diveScroll, connScroll, crossfade, stepScale, lerp,
                 magnetDelay, magnetScale, preloadGate }   — any top-level key,
         shadowing it while the phone variant is live.
       section.rangeMobile / .settleMobile / .scrollMobile — same idea per scene: a
         portrait re-render of one continuous take can split on a different doorway
         frame and rest on a different one.
       preloadGate: n — the loading gate waits on the first n clips only and streams
         the rest in behind the revealed page.
       - coalesces seeks (never issues a new currentTime while the decoder is still
         `seeking`) so fast flicks can't pile up and freeze the video.
       - keeps the still as a live poster until the clip actually paints its first frame,
         and primes each video (muted play→pause) on first touch — this is what stops iOS
         from showing a blank scene before the first seek.
       - drops the drifting particles and ignores URL-bar-only resizes (no scroll jump).
     Nothing here is required — a config with only `clip`/`connectors` still works on
     phones; the mobile variants just make it lighter and smoother.

   THEME (CSS custom properties; set on the container or :root to override)
     --sw-bg         page background (match your scene bg for seamless posters)
     --sw-ink        primary text
     --sw-ink-soft   secondary text
     --sw-accent     default accent (each section overrides via its `accent`)
     --sw-font-display / --sw-font-body

   REQUIREMENTS ON YOUR ASSETS
     - clips encoded native-res, crf~20, -g 8, +faststart, no audio
     - connectors' endpoints are the neighbouring dives' ACTUAL frames
     - (optional) mobile variants at ~720p, -g 4 for smoother phone scrubbing
   The engine loads each clip as a Blob (always seekable) and scrubs currentTime; it does
   NOT depend on HTTP byte-range support.
   ========================================================================== */

function mountScrollWorld(container, config) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Phone detection. `coarse` is captured once (input type doesn't change mid-session);
  // the ≤860px query is read live via isMobile() so a desktop resize/DevTools toggle
  // switches sources and seek behaviour without a reload.
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const smallMQ = window.matchMedia('(max-width: 860px)');
  const isMobile = () => coarse || smallMQ.matches;
  const SECTIONS = config.sections || [];
  const CONNECTORS = config.connectors || [];
  const CONNECTORS_M = config.connectorsMobile || [];
  // MOBILE OVERRIDES — a `mobile` block whose keys shadow the top-level ones while
  // the phone variant is live. Phones want a different film, not the same film
  // squeezed: a shorter hold (less thumb travel per stop), a wider seam dissolve
  // (portrait crops harder, so a seam is more visible), a lazier lerp.
  //
  // Everything derived from these is LIVE, not captured at mount: crossing the
  // breakpoint on a desktop resize re-runs tune() and relayouts. Anything read
  // once here would silently keep the wrong variant's pacing after a switch.
  const MOB = config.mobile || {};
  let mobileNow = isMobile();
  let DIVE_W, CONN_W, CROSSFADE, HOLD, STEP_SCALE, LERP, MAGNET_MS, MAGNET_SCALE;
  // A dive's scroll range splits into three phases when HOLD is on; FLIGHT_END and
  // HOLD_END are the two boundaries. They are derived from HOLD and read by
  // segProgress, read()'s copy timing and buildStations() — recompute all three
  // together or the camera parks on one frame while the magnet pulls to another.
  let FLIGHT_END, HOLD_END;
  function opt(key, dflt) {
    if (mobileNow && MOB[key] != null) return MOB[key];
    return config[key] != null ? config[key] : dflt;
  }
  function tune() {
    DIVE_W = opt('diveScroll', 1.3);
    CONN_W = opt('connScroll', 0.9);
    CROSSFADE = opt('crossfade', 0.12);        // seam dissolve width (vh)
    // HOLD — trailing fraction of a dive's scroll range where the clip is parked
    // on its settle frame instead of still scrubbing. This is what creates a
    // second stable resting frame per scene: the flight completes, then the
    // camera sits still while the copy is read. 0 = scrub straight to the seam.
    HOLD = Math.min(0.8, Math.max(0, opt('hold', 0)));
    // Multiplier on how long a step between stations takes. 1 = the default pace.
    STEP_SCALE = opt('stepScale', 1) > 0 ? opt('stepScale', 1) : 1;
    // Per-frame catch-up on the scrubbed time. Lower = smoother but laggier; on a
    // phone decoder a lazier lerp is fewer seeks per flick.
    LERP = opt('lerp', 0.18);
    // The magnet: how long after the last scroll event it waits, and how hard it
    // pulls. A finger's momentum tail is longer and lumpier than a trackpad's, so
    // phones wait longer and travel slower — a fast yank reads as the page
    // fighting the gesture.
    MAGNET_MS = opt('magnetDelay', 140);
    MAGNET_SCALE = opt('magnetScale', 1);
    FLIGHT_END = HOLD > 0 ? (1 - HOLD) * 0.68 : 1;
    HOLD_END = HOLD > 0 ? FLIGHT_END + HOLD : 1;
  }
  tune();
  // SNAP — station-to-station navigation. With it on, the only scroll positions a
  // visitor can come to rest at are the stations (each scene's opening frame and
  // its arrival frame); every position between them is traversed by an animated
  // tween, so a flight or a seam dissolve always completes rather than being
  // dragged through by hand. Opt-in, and not variant-dependent.
  const SNAP = config.snap === true;
  // PRELOAD — fetch every clip up front rather than lazily near the viewport, and
  // report progress so the host page can hold a loading screen until the whole
  // film is decodable. Without it the first scenes scrub as stills until their
  // blobs land, which reads as "the animation is missing".
  const PRELOAD = config.preload === true || config.preload === 'all';
  // The right-hand route rail: a vertical track with a dot per scene. Reads as a
  // scrollbar, and duplicates the topbar nav. Opt out with route: false.
  const SHOW_ROUTE = config.route !== false;
  // The hairline progress bar across the top of the viewport. Opt out with
  // progress: false.
  const SHOW_PROGRESS = config.progress !== false;
  const N = SECTIONS.length;
  if (!N) return;

  injectCSS();
  container.classList.add('sw-root');

  // ---- teardown bookkeeping -------------------------------------------------
  // Every listener the engine puts on the window, plus its timers and frame
  // loops, are registered here so destroy() can take them all back.
  //
  // This matters in a single-page app. The engine's listeners are global, but
  // its DOM is not: routing away unmounts the container while the listeners
  // survive, and the snap magnet then keeps yanking the *next* page's scroll
  // position onto a station that no longer exists. Anything long-lived added
  // below goes through on()/track() so it can't be forgotten here.
  let destroyed = false;
  const bound = [];
  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    bound.push(() => target.removeEventListener(type, handler, opts));
  }

  // ---- build the interleaved segment chain: dive0, conn0, dive1, … diveN-1 ----
  const SEGMENTS = [];
  SECTIONS.forEach((s, i) => {
    // rangeM / settleM / scrollM shadow their desktop twins while the mobile
    // variant is live. A portrait render of the same take can split at a
    // different doorway frame and want a different resting frame, so the split
    // fractions are per-variant, not per-file.
    const dive = { kind: 'dive', si: i, clip: s.clip, clipM: s.clipMobile, still: s.still, stillM: s.stillMobile,
                   accent: s.accent, w: 0, scroll: s.scroll, scrollM: s.scrollMobile,
                   linger: s.linger || 0, range: s.range, rangeM: s.rangeMobile,
                   settle: s.settle, settleM: s.settleMobile };
    SEGMENTS.push(dive);
    s._seg = dive;
    // A connector is optional: if connectors[i] is falsy, the two dives simply
    // crossfade directly (no fly-over). Lets a page complete even when a
    // connector can't be generated (e.g. a content-filter false-positive).
    if (i < N - 1 && CONNECTORS[i]) {
      SEGMENTS.push({ kind: 'conn', si: i, clip: CONNECTORS[i], clipM: CONNECTORS_M[i],
                      still: SECTIONS[i + 1].still, stillM: SECTIONS[i + 1].stillMobile,
                      accent: SECTIONS[i + 1].accent, w: 0 });
    }
  });
  const NSEG = SEGMENTS.length;

  // ---- DOM ----
  const sky = el('div', 'sw-sky');
  if (config.atmosphere !== false) {
    sky.appendChild(el('div', 'sw-sky__grad'));
    sky.appendChild(el('div', 'sw-sky__glow'));
  }
  const particles = el('div', 'sw-particles'); sky.appendChild(particles);

  const scrollbar = el('div', 'sw-scrollbar');
  const scrollbarFill = el('span'); scrollbar.appendChild(scrollbarFill);

  const topbar = el('div', 'sw-topbar');
  // The bar is this page's site header. It sits alongside the copy layer (which
  // carries role=main below), not inside it, so the banner stays top level.
  topbar.setAttribute('role', 'banner');
  if (config.brand) {
    const brand = el('a', 'sw-brand'); brand.href = (config.brand.href || '#');
    brand.appendChild(el('span', 'sw-brand__mark'));
    const nm = el('span', 'sw-brand__name'); nm.textContent = config.brand.name || ''; brand.appendChild(nm);
    topbar.appendChild(brand);
  }
  const nav = el('nav', 'sw-nav'); nav.setAttribute('aria-label', 'Film sections');
  if (config.nav !== false) topbar.appendChild(nav);
  if (config.cta && config.cta.label) {
    const c = el('a', 'sw-topcta'); c.href = config.cta.href || '#'; c.textContent = config.cta.label;
    if (/^\/(?!\/)/.test(c.getAttribute('href'))) c.setAttribute('data-sw-nav', '');
    topbar.appendChild(c);
  }

  // The scenes are silent footage and their posters are decorative (alt=""),
  // so the whole stage is presentation. Hiding it here also keeps it out of the
  // "content outside a landmark" reckoning.
  const stage = el('div', 'sw-stage'); stage.setAttribute('aria-hidden', 'true');
  const copylayer = el('div', 'sw-copylayer');
  // Everything a visitor is meant to read lives here: the scenes behind it are
  // silent footage (aria-hidden, see loadClip) and the stills are decorative.
  copylayer.setAttribute('role', 'main');
  const route = el('div', 'sw-route');
  const hint = el('div', 'sw-hint'); hint.setAttribute('aria-hidden', 'true');
  const hintText = el('span'); hintText.textContent = config.hint || 'scroll'; hint.appendChild(hintText);
  hint.appendChild(el('i'));
  const track = el('div', 'sw-track');

  [sky, topbar, stage, copylayer, hint, track].forEach(n => container.appendChild(n));
  if (SHOW_PROGRESS) container.insertBefore(scrollbar, topbar);
  if (SHOW_ROUTE) container.insertBefore(route, hint);

  // segment scenes
  SEGMENTS.forEach(s => {
    const scene = el('div', 'sw-scene'); scene.style.setProperty('--sw-accent', s.accent || '');
    const img = el('img', 'sw-scene__still'); img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
    // A missing mobile poster must not leave a black scene: fall back to the
    // desktop still, which is a crop of the right room rather than nothing. This
    // is what lets the page ship before the portrait renders land.
    img.addEventListener('error', () => {
      if (s.still && img.getAttribute('src') !== s.still) img.src = s.still;
    });
    const poster = posterOf(s);
    if (poster) img.src = poster;
    scene.appendChild(img); stage.appendChild(scene);
    s.el = scene; s.img = img; s.video = null; s.hasClip = false;
    s.loading = false; s.ready = false; s.cur = 0; s.target = 0; s.visible = false;
  });

  // per-section copy / route / nav
  //
  // `intro` is an optional second copy block for a section, shown while the scene
  // is still at its opening frame and retired as the flight starts. It exists so
  // the landing scene can greet you before the section's own copy lands with the
  // camera, instead of opening on a mid-film statement.
  const copies = [], intros = [], dots = [];
  SECTIONS.forEach((s, i) => {
    const c = el('article', 'sw-copy'); c.style.setProperty('--sw-accent', s.accent || '');
    // Every block but the one on screen is invisible, so it must also be out of
    // the tab order and out of the accessibility tree — otherwise a keyboard
    // user lands on CTAs painted on nothing and a screen reader reads all five
    // scenes as one wall of text. read() lifts inert from the live block.
    c.setAttribute('inert', '');
    c.innerHTML = `<span class="sw-copy__num">${pad(i + 1)} / ${pad(N)}</span>` + copyHTML(s);
    copylayer.appendChild(c); copies.push(c);

    let ic = null;
    if (s.intro) {
      ic = el('article', 'sw-copy sw-copy--intro'); ic.style.setProperty('--sw-accent', s.accent || '');
      ic.setAttribute('inert', '');
      ic.innerHTML = copyHTML(s.intro);
      copylayer.appendChild(ic);
    }
    intros.push(ic);

    if (SHOW_ROUTE) {
      const dot = el('button', 'sw-route__dot'); dot.style.setProperty('--sw-accent', s.accent || '');
      dot.innerHTML = `<span class="sw-route__label">${esc(s.label || '')}</span><i></i>`;
      dot.addEventListener('click', () => jumpTo(i)); route.appendChild(dot); dots.push(dot);
    }

    if (config.nav !== false) {
      const b = el('button', 'sw-nav__item'); b.textContent = s.label || '';
      b.addEventListener('click', () => jumpTo(i)); nav.appendChild(b);
    }
  });

  // ---- math ----
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  // Per-section dwell: monotone remap of scroll→time so the camera settles mid-scene
  // (where the copy peaks) and moves quicker near the seams. L=0 linear, L=1 full
  // mid-scene pause. f(0)=0, f(1)=1 always, so seam frames are untouched.
  const lingerEase = (x, L) => { L = clamp(L); const c = x - 0.5; return (1 - L) * x + L * (4 * c * c * c + 0.5); };
  // A dive's scroll range splits into three phases when HOLD is on:
  //   [0, FLIGHT_END]        fly in, clip 0 → the scene's `settle` frame
  //   [FLIGHT_END, HOLD_END] parked on `settle` — this is the arrival station
  //   [HOLD_END, 1]          release the tail, `settle` → end of the clip
  // The third phase matters because these clips are one continuous take: each one
  // spends its last beat gliding toward the NEXT room, so its final frame is a
  // doorway, not a destination. Parking on `settle` instead of the last frame is
  // what keeps a scene's resting image its own subject.
  function settleOf(s) {
    const v = (mobileNow && s.settleM != null) ? s.settleM : s.settle;
    return (v != null) ? clamp(v) : 1;
  }
  function segProgress(s, local) {
    if (HOLD <= 0 || s.kind !== 'dive') return s.linger ? lingerEase(local, s.linger) : local;
    const settle = settleOf(s);
    if (local <= FLIGHT_END) {
      const x = FLIGHT_END > 0 ? local / FLIGHT_END : 1;
      return (s.linger ? lingerEase(x, s.linger) : x) * settle;
    }
    if (local <= HOLD_END) return settle;
    return settle + ((local - HOLD_END) / Math.max(1e-4, 1 - HOLD_END)) * (1 - settle);
  }
  let vh = window.innerHeight, stageX = 0, totalW = 0, activeIndex = -1, ticking = false;
  let laidOutW = window.innerWidth;   // width the current layout was computed at (see onResize)
  let stations = [], tween = null, inputLock = 0, settleTimer = 0, resizeTimer = 0, touching = false;

  // Scroll distance a segment gets, in viewport heights. Live, because a phone's
  // thumb travel is not a mouse wheel's: the mobile block and `scrollMobile`
  // shorten the film without touching the desktop pacing.
  function widthOf(s) {
    if (s.kind === 'conn') return CONN_W;
    if (mobileNow && s.scrollM) return s.scrollM;
    return s.scroll || DIVE_W;
  }

  function layout() {
    vh = window.innerHeight;
    laidOutW = window.innerWidth;
    stageX = window.innerWidth > 860 ? 4 : 0;
    let off = 0;
    SEGMENTS.forEach(s => { s.w = widthOf(s); s.start = off * vh; off += s.w; s.end = off * vh; });
    totalW = off;
    track.style.height = (totalW * vh + vh) + 'px';   // +1vh so the last flight completes
    buildStations();
    read();
  }

  // ---- stations ------------------------------------------------------------
  // The scroll positions a visitor is allowed to come to rest at:
  //   the film's very first frame, camera still outside the first room, and
  //   each scene's arrival — inside its HOLD window, camera landed and parked,
  //   that scene's copy fully up.
  // Only the FIRST scene contributes an opening station. This is one continuous
  // take: every later scene opens on the frame its predecessor closed on (that is
  // what makes the seams invisible), so an opening station at each seam would be
  // a step that advances the scroll without changing the picture. Everything
  // between stations is mid-flight or mid-dissolve and is only ever crossed by an
  // animated tween (see gotoStation), never parked in.
  function buildStations() {
    const maxY = Math.max(0, totalW * vh);
    stations = [];
    const arriveLocal = HOLD > 0 ? FLIGHT_END + HOLD / 2 : 1;
    SEGMENTS.forEach((s, i) => {
      if (s.kind !== 'dive') return;
      const arrive = Math.min(s.start + (s.end - s.start) * arriveLocal, maxY);
      s._openY = s.start;
      s._arriveY = arrive;
      if (i === 0) stations.push(s.start);
      stations.push(arrive);
    });
    // Land the final station on the document bottom so the closing scene has no
    // dead scroll past its own resting frame.
    if (stations.length) {
      stations[stations.length - 1] = maxY;
      SEGMENTS[SEGMENTS.length - 1]._arriveY = maxY;
    }
    stations = stations
      .sort((a, b) => a - b)
      .filter((v, i, a) => i === 0 || v - a[i - 1] > 8);
  }

  function nearestStation(y) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < stations.length; i++) {
      const d = Math.abs(stations[i] - y);
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }

  // Animated travel to an absolute scroll position. Native smooth scrolling is
  // not used: its duration is UA-defined and can be interrupted by the very wheel
  // events we are suppressing, which leaves the page parked mid-dissolve.
  function tweenTo(y, dur) {
    y = Math.max(0, Math.min(totalW * vh, y));
    const from = window.scrollY || window.pageYOffset;
    const dist = y - from;
    if (Math.abs(dist) < 1) return;
    if (reduce) { window.scrollTo(0, y); return; }
    const t0 = performance.now();
    const D = dur || Math.min(1150, Math.max(560, (Math.abs(dist) / vh) * 700)) * STEP_SCALE;
    const token = {};
    tween = token;
    const step = now => {
      if (tween !== token) return;             // superseded or cancelled
      const p = Math.min(1, (now - t0) / D);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;   // easeInOutCubic
      window.scrollTo(0, from + dist * e);
      if (p < 1) requestAnimationFrame(step);
      else { tween = null; inputLock = performance.now() + 260; }
    };
    requestAnimationFrame(step);
  }

  // One step along the station chain, in the direction of the gesture. If we are
  // adrift between stations (scrollbar drag, deep link, resize) the first step
  // lands on the station ahead in that direction rather than skipping one.
  function gotoStation(dir) {
    if (!stations.length) return;
    const y = window.scrollY || window.pageYOffset;
    const i = nearestStation(y);
    const settled = Math.abs(stations[i] - y) < 6;
    let t;
    if (settled) t = i + dir;
    else if (dir > 0) t = stations[i] > y ? i : i + 1;
    else t = stations[i] < y ? i : i - 1;
    t = Math.max(0, Math.min(stations.length - 1, t));
    tweenTo(stations[t]);
  }

  function jumpTo(i) {
    const seg = SECTIONS[i]._seg;
    if (SNAP) { tweenTo(seg._arriveY != null ? seg._arriveY : seg.start); return; }
    window.scrollTo({ top: seg.start + (seg.end - seg.start) * 0.5, behavior: reduce ? 'auto' : 'smooth' });
  }

  // ---- auto-scroll (opt-in) --------------------------------------------------
  // `autoScroll: { delay, dwell }` — after `delay` ms with no interaction, step
  // through the stations on the visitor's behalf, one per `dwell` ms, via the
  // existing gotoStation. That reuses the snap magnet (see the scroll listener's
  // settleTimer) rather than a second rAF loop fighting it. Any real interaction
  // cancels it for the session. Armed from announceReady (below), not at mount —
  // a host page holding a loading gate behind onReady would otherwise burn the
  // delay before the visitor can see anything.
  //
  // This block sits ABOVE the readiness accounting on purpose: that block can
  // call announceReady() synchronously (reduced motion, or a config with no
  // clips), and announceReady calls armAutoScroll. These bindings have to be
  // initialised by then or that path throws on the temporal dead zone.
  const AUTO = config.autoScroll;
  let autoTimer = 0, autoInterval = 0, autoCancelled = !AUTO || reduce;
  function cancelAutoScroll() {
    if (autoCancelled) return;
    autoCancelled = true;
    clearTimeout(autoTimer);
    clearInterval(autoInterval);
  }
  function armAutoScroll() {
    if (autoCancelled) return;
    const delay = AUTO.delay != null ? AUTO.delay : 3000;
    const dwell = AUTO.dwell != null ? AUTO.dwell : 5200;
    autoTimer = window.setTimeout(() => {
      if (autoCancelled) return;
      autoInterval = window.setInterval(() => {
        if (autoCancelled) { clearInterval(autoInterval); return; }
        const y = window.scrollY || window.pageYOffset;
        // Never wrap: once the last station is reached, stop advancing.
        if (!stations.length || y >= stations[stations.length - 1] - 1) {
          clearInterval(autoInterval);
          return;
        }
        gotoStation(1);
      }, dwell);
    }, delay);
  }
  if (!autoCancelled) {
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(evt =>
      on(window, evt, cancelAutoScroll, { passive: true })
    );
    // Someone reading at 400% zoom, or tabbing the chrome, may never wheel or
    // tap — and they are exactly who the page moving under them hurts. A real
    // cursor move or the first focus is intent enough to stop the tour.
    // movementX/Y filters the synthetic mousemove a browser fires when the page
    // scrolls under a stationary pointer, which would otherwise cancel the tour
    // on its own first step.
    on(window, 'mousemove', e => { if (e.movementX || e.movementY) cancelAutoScroll(); }, { passive: true });
    on(window, 'focusin', cancelAutoScroll, { passive: true });
  }

  // ---- readiness accounting (drives the host page's loading gate) -----------
  // A clip counts as settled once it is decodable (metadata in) or has failed for
  // good. Failures still count so a single missing file can never wedge a page
  // that is waiting on onReady before it reveals itself.
  const clipSegs = SEGMENTS.filter(s => s.clip);
  // A metered or slow connection. The clips are the heaviest thing this engine
  // does — a full film is tens of megabytes — so on one of these we never run
  // the second wave and let the proximity loader in read() fetch a scene only
  // once the visitor is nearly on it. Safari has no navigator.connection, so
  // this is false there and the film behaves as it always has. Fail open on
  // purpose: guessing "slow" wrong costs the visitor the animation.
  function thrifty() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return false;
    if (c.saveData) return true;
    return /^(slow-2g|2g|3g)$/.test(c.effectiveType || '');
  }
  // GATE — how many clips the host's loading screen waits on. Default: all of
  // them. `preloadGate: n` (or `mobile.preloadGate`) waits on the first n and
  // streams the rest in behind the revealed page, which is the difference on a
  // phone between a 4-clip wait and a 2-clip wait before the first scroll. It is
  // read once, at mount, because that is the only moment the gate exists.
  const GATE = (() => {
    const n = opt('preloadGate', 0);
    return n > 0 ? Math.min(n, clipSegs.length) : clipSegs.length;
  })();
  clipSegs.forEach((s, i) => { s._gated = i < GATE; });
  let settledClips = 0, announcedReady = false, lastAheadFrom = -1;
  function announceReady() {
    if (announcedReady) return;
    announcedReady = true;
    armAutoScroll();
    if (config.onReady) { try { config.onReady(); } catch (e) {} }
    // Second wave: only the first clip the gate did not wait on, now that the
    // visitor has the page. Ordered after onReady so it competes with nothing
    // for the first scroll's bandwidth. From here read() keeps one scene ahead
    // of wherever the visitor is; a phone that never scrolls past the hall
    // never downloads the studio. Most don't.
    if (PRELOAD && GATE < clipSegs.length && !thrifty()) {
      const first = clipSegs.find(s => !s._gated);
      if (first) loadClip(first);
    }
  }
  // The scene after the current one. Fetched as soon as the visitor lands on a
  // scene, so it has a whole scene's worth of scrolling to arrive in, rather
  // than the 1.6 screens the proximity loader below allows.
  function loadAhead(ci) {
    if (!PRELOAD || thrifty()) return;
    for (let i = ci + 1; i < NSEG; i++) {
      if (SEGMENTS[i].clip) { loadClip(SEGMENTS[i]); return; }
    }
  }
  // Only the initial load moves the bar. A variant switch reloads every clip, and
  // counting those would push the host's progress past 100%.
  function noteSettled(s) {
    if (announcedReady || !s._gated || s._settled) return;
    s._settled = true;
    settledClips++;
    if (config.onProgress) { try { config.onProgress(settledClips, GATE); } catch (e) {} }
    if (settledClips >= GATE) announceReady();
  }
  // Reduced motion never loads a clip, and a config with no clips has nothing to
  // wait for; in both cases the page is ready as soon as it is mounted.
  if (reduce || !clipSegs.length) {
    if (config.onProgress) { try { config.onProgress(GATE, GATE); } catch (e) {} }
    announceReady();
  }

  // One fetch per URL. Two scenes can share a clip (a `range` each) to split one
  // continuous take into separate stops without re-downloading it; they still get
  // a video element each, since both are on screen together through the dissolve.
  const blobCache = new Map();
  function fetchClip(url) {
    if (!blobCache.has(url)) {
      blobCache.set(url, fetch(url).then(r => r.ok ? r.blob() : Promise.reject(new Error('404'))));
    }
    return blobCache.get(url);
  }

  // The slice of a clip a segment plays, as [0..1] fractions of its duration.
  // A portrait re-render of the same continuous take can put its doorway on a
  // different frame, so the split is per-variant.
  function rangeOf(s) {
    const r = (mobileNow && s.rangeM) ? s.rangeM : s.range;
    if (!r || r.length !== 2) return [0, 1];
    const a = clamp(r[0]), b = clamp(r[1]);
    return b > a ? [a, b] : [0, 1];
  }
  function clipOf(s) { return (mobileNow && s.clipM) ? s.clipM : s.clip; }
  function posterOf(s) { return (mobileNow && s.stillM) ? s.stillM : s.still; }

  function loadClip(s) {
    // Under prefers-reduced-motion we never load the clips at all — the stills stay up
    // and simply cross-dissolve as you scroll. No scrubbed video motion, no decode cost.
    if (reduce || s.loading || !s.clip) return;
    s.loading = true;
    // Serve the lighter mobile encode on phones when one was provided.
    const url = clipOf(s);
    s.loadedUrl = url;
    // Returned so the second wave can start the next clip when this one's bytes
    // are down; every other caller ignores it.
    return fetchClip(url)
      .then(blob => {
        // A breakpoint crossing while this fetch was in flight already asked for
        // the other variant. Drop this one on the floor rather than attaching a
        // desktop decoder to a scene that is now portrait.
        if (destroyed || s.loadedUrl !== url) return;
        const v = document.createElement('video');
        v.className = 'sw-scene__video';
        v.muted = true; v.playsInline = true; v.preload = 'auto';
        // Decorative, like the stills' alt="": silent footage of a scene the
        // copy block already describes. Also clears axe's caption check.
        v.setAttribute('aria-hidden', 'true');
        v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
        v.src = URL.createObjectURL(blob);
        v.addEventListener('loadedmetadata', () => {
          s.ready = true;
          // Park on this segment's own first frame so a `seeked` fires and the
          // scene swaps from its still to real video. At scroll 0 the raf loop's
          // target and current time already agree, so without this nudge the
          // opening scene would sit on its poster until the visitor scrolled —
          // the clip present but never shown.
          try { v.currentTime = rangeOf(s)[0] * (v.duration || 0) + 0.001; } catch (e) {}
          noteSettled(s);
          read();
        });
        // Reveal the video (hide the still poster) only once a real frame has
        // painted — on iOS a seeked-but-never-played muted video stays blank, so
        // hiding the still on metadata alone would flash an empty scene.
        v.addEventListener('seeked', () => { s.el.classList.add('has-clip'); }, { once: true });
        v.addEventListener('loadeddata', () => { try { v.pause(); } catch (e) {} if (userReady) primeVideo(v); });
        s.el.appendChild(v); s.video = v; s.hasClip = true;
      }).catch(() => { if (s.loadedUrl === url) { s.loading = false; noteSettled(s); } });
  }

  // ---- variant switching ----------------------------------------------------
  // Tear a segment's decoder down so the other variant's file can take its place.
  // The still goes back to being a live poster (has-clip off) for the gap — the
  // same rule the iOS blank-frame fix relies on, so the swap never shows an empty
  // scene while the replacement decodes.
  function detachVideo(s) {
    const v = s.video;
    s.video = null; s.hasClip = false; s.ready = false; s.loading = false;
    s.el.classList.remove('has-clip');
    if (!v) return;
    try {
      v.pause();
      if (v.src && v.src.startsWith('blob:')) URL.revokeObjectURL(v.src);
      v.removeAttribute('src');
      v.load();
    } catch (e) {}
    v.remove();
  }

  // Where the camera is in the film, as (segment, fraction within it). Scroll
  // pixels are not portable across a switch: the mobile variant can give a scene
  // a different `scroll` width and a different `settle`, so the stations move.
  // The fraction does survive, which is what keeps the picture from jumping.
  function capturePlace() {
    const y = window.scrollY || window.pageYOffset;
    let i = 0;
    for (let k = 0; k < NSEG; k++) if (y >= SEGMENTS[k].start) i = k;
    const s = SEGMENTS[i];
    return { i, f: clamp((y - s.start) / Math.max(1, s.end - s.start), 0, 1) };
  }

  // Swap every scene to the other variant's clip and poster, keeping the camera
  // where it was. Called from the debounced resize when the breakpoint is crossed
  // — never on a URL-bar height change, which never crosses it.
  function switchVariant() {
    const place = capturePlace();
    mobileNow = isMobile();
    tune();
    SEGMENTS.forEach(s => {
      detachVideo(s);
      const poster = posterOf(s);
      if (poster && s.img.getAttribute('src') !== poster) s.img.src = poster;
      s.loadedUrl = null;
    });
    layout();                       // new widths, new stations, new hold window
    const seg = SEGMENTS[place.i];
    window.scrollTo(0, seg.start + (seg.end - seg.start) * place.f);
    // The lerp would otherwise spend a second catching up from the old variant's
    // normalised time; the picture is meant to be the same frame, so start there.
    SEGMENTS.forEach(s => { s.cur = s.target; });
    // Same rule as the second wave: on a metered connection the read() below
    // pulls in the scenes near the camera and leaves the rest to the proximity
    // loader, rather than re-fetching the whole film in the other variant.
    if (PRELOAD && !thrifty()) SEGMENTS.forEach(loadClip);
    read();
  }

  function read() {
    if (destroyed) return;
    // iOS Safari reports scrollY past both ends while the page rubber-bands, and
    // `overscroll-behavior` doesn't stop it. Every opacity below is distance-from-
    // segment over the crossfade width, so an unclamped y fades the whole film out
    // — a 66px pull at the top (mobile crossfade 0.1) is enough to leave a blank
    // screen. Clamp to the track the layout actually built.
    const y = clamp(window.scrollY || window.pageYOffset, 0, totalW * vh);
    const fade = CROSSFADE * vh;
    let ci = 0;
    for (let i = 0; i < NSEG; i++) if (y >= SEGMENTS[i].start) ci = i;
    if (ci !== lastAheadFrom) { lastAheadFrom = ci; loadAhead(ci); }

    for (let i = 0; i < NSEG; i++) {
      const s = SEGMENTS[i];
      // Unconditional: loadClip no-ops on a clip already in flight, so with
      // PRELOAD this only catches a scene loadAhead hasn't finished — or, on a
      // thrifty connection, every scene but the gated ones.
      if (y > s.start - 1.6 * vh && y < s.end + 1.6 * vh) loadClip(s);
      const local = clamp((y - s.start) / (s.end - s.start), 0, 1);
      const flight = segProgress(s, local);
      s.target = flight;
      let outside = 0;
      if (y < s.start) outside = s.start - y; else if (y > s.end) outside = y - s.end;
      const op = smooth(1 - outside / fade);
      // Every style write below is guarded on an actual change. Eight scenes ×
      // three properties × 60Hz is a lot of style invalidation for values that
      // are constant for most of the film — six of the eight scenes are fully
      // transparent at any moment and their numbers never move.
      if (op !== s._op) {
        s.el.style.opacity = op;
        s.visible = op > 0.001;
        // will-change pins a composited layer. Leaving it on all eight scenes
        // holds eight full-viewport layers in GPU memory for the whole session,
        // which is the single biggest memory line on a phone. Promote only the
        // scenes actually on screen — the flag flips at most twice per seam.
        s.el.classList.toggle('is-live', s.visible);
        s._op = op;
      }
      const z = (i === ci) ? '120' : String(100 + Math.round(op * 10));
      if (z !== s._z) { s.el.style.zIndex = z; s._z = z; }
      if (!s.hasClip || !s.ready) {
        const sc = reduce ? 1 : 1.03 + flight * 0.14;
        const tr = `translateX(${stageX - 2}vw) scale(${sc.toFixed(3)})`;
        if (tr !== s._tr) { s.img.style.transform = tr; s._tr = tr; }
      }
    }

    // Copy timing. With a HOLD window every section reads the same way: the block
    // rises over the tail of the flight so it is fully legible the moment the
    // camera parks, stays up for the whole hold (the arrival station), then clears
    // before the seam. Without HOLD the original mid-scene peak is kept, so the
    // engine still behaves as documented for pages that do not opt in.
    const rise0 = FLIGHT_END * 0.55;
    for (let i = 0; i < N; i++) {
      const seg = SECTIONS[i]._seg;
      const pr = clamp((y - seg.start) / (seg.end - seg.start), 0, 1);
      const before = y < seg.start, after = y > seg.end;
      let cop;
      if (HOLD > 0) {
        cop = smooth((pr - rise0) / Math.max(1e-4, FLIGHT_END - rise0));
        // Every section but the last clears out across its exit tail, so the copy
        // is gone before the dissolve into the next scene begins.
        if (i < N - 1) cop *= smooth((1 - pr) / Math.max(1e-4, (1 - HOLD_END) * 0.85));
        // `after` is deliberately not applied to the closing section: the document's
        // maximum scroll rounds up to a whole pixel and can land a hair past that
        // segment's end, which would blank the closing copy — the CTA — exactly at
        // the bottom of the page.
        if (before || (after && i < N - 1)) cop = 0;
      } else if (i === 0) cop = after ? 0 : smooth(1 - pr / 0.62);     // greets on landing
      else if (i === N - 1) cop = before ? 0 : smooth(pr / 0.4);       // holds CTA at the end
      else cop = (before || after) ? 0 : smooth(1 - Math.abs(pr - 0.5) / 0.5);
      const c = copies[i];
      if (cop !== c._cop) { c.style.opacity = cop; c._cop = cop; }
      // Parallax is published as a custom property, never as an inline transform:
      // the stylesheet owns the block's centring transform, and an inline one
      // would replace it (dropping translateY(-50%)) and push tall blocks such as
      // the closing CTA off the bottom of the viewport.
      // Shallow parallax. Stations do not all sit at the same `pr` — the closing
      // one rests at the very end of its range while the others rest mid-hold — so
      // a deep travel here would land the type at visibly different heights from
      // one stop to the next, which is exactly what the top anchor is for.
      const shift = reduce ? '0vh' : ((0.5 - pr) * 1.5).toFixed(3) + 'vh';
      if (shift !== c._shift) { c.style.setProperty('--sw-shift', shift); c._shift = shift; }
      const live = cop > 0.5;
      const pe = live ? 'auto' : 'none';
      if (pe !== c._pe) { c.style.pointerEvents = pe; c._pe = pe; }
      if (live !== c._live) { c.toggleAttribute('inert', !live); c._live = live; }

      const ic = intros[i];
      if (ic) {
        const icop = (before || after) ? 0 : smooth(1 - pr / Math.max(1e-4, rise0 * 0.72));
        if (icop !== ic._cop) { ic.style.opacity = icop; ic._cop = icop; }
        const ish = reduce ? '0vh' : (-pr * 2).toFixed(3) + 'vh';
        if (ish !== ic._shift) { ic.style.setProperty('--sw-shift', ish); ic._shift = ish; }
        const ilive = icop > 0.5;
        const ipe = ilive ? 'auto' : 'none';
        if (ipe !== ic._pe) { ic.style.pointerEvents = ipe; ic._pe = ipe; }
        if (ilive !== ic._live) { ic.toggleAttribute('inert', !ilive); ic._live = ilive; }
      }
    }

    const cur = SEGMENTS[ci];
    const near = clamp(cur.kind === 'dive' ? cur.si
      : (((y - cur.start) / (cur.end - cur.start)) > 0.5 ? cur.si + 1 : cur.si), 0, N - 1);
    if (near !== activeIndex) {
      activeIndex = near;
      dots.forEach((d, k) => d.classList.toggle('is-active', k === near));
      nav.querySelectorAll('.sw-nav__item').forEach((n, k) => {
        n.classList.toggle('is-active', k === near);
        // The class is colour only; aria-current is the half a screen reader hears.
        if (k === near) n.setAttribute('aria-current', 'true'); else n.removeAttribute('aria-current');
      });
      container.style.setProperty('--sw-accent', SECTIONS[near].accent || '');
    }
    if (SHOW_PROGRESS) scrollbarFill.style.transform = `scaleX(${clamp(y / (totalW * vh))})`;
    const hop = clamp(1 - y / (0.5 * vh));
    if (hop !== hint._op) { hint.style.opacity = hop; hint._op = hop; }
    // Particles are already off on phones (seedParticles); skip the write entirely
    // when there are none rather than transforming an empty layer every frame.
    if (particles && particles.firstChild) particles.style.transform = `translate3d(0, ${-y * 0.05}px, 0)`;
    ticking = false;
  }

  function raf() {
    if (destroyed) return;   // stop rescheduling; nothing left to scrub
    const eps = mobileNow ? 0.02 : 0.008;   // coarser seek step on phones = fewer decodes
    for (let i = 0; i < NSEG; i++) {
      const s = SEGMENTS[i];
      if (!s.hasClip || !s.ready || !s.video) continue;
      // Never queue a seek while the decoder is still resolving the last one.
      // On phones a fast flick would otherwise pile up seeks and freeze the clip;
      // cur keeps lerping, so we snap to the latest target the moment it's free.
      if (s.video.seeking) continue;
      if (!s.visible && Math.abs(s.cur - s.target) < 0.002) continue;
      s.cur += (s.target - s.cur) * (reduce ? 1 : LERP);
      const dur = s.video.duration || 1;
      // Map this segment's 0..1 progress onto its slice of the clip, then stay a
      // hair inside the tail: seeking exactly to duration lands past the last
      // frame on some decoders and paints black.
      const r = rangeOf(s);
      const t = Math.min((r[0] + (r[1] - r[0]) * clamp(s.cur)) * dur, dur - 0.04);
      if (Math.abs(s.video.currentTime - t) > eps) { try { s.video.currentTime = t; } catch (e) {} }
    }
    requestAnimationFrame(raf);
  }

  // iOS needs a user gesture before a muted video will decode/paint reliably. On the
  // first touch we prime every loaded clip (muted play→pause) so the first seek is
  // instant instead of showing a blank frame. `userReady` also makes freshly-loaded
  // clips prime themselves (see loadClip).
  let userReady = false;
  function primeVideo(v) {
    if (!mobileNow || !v) return;
    try { const p = v.play(); if (p && p.then) p.then(() => { try { v.pause(); } catch (e) {} }).catch(() => {}); }
    catch (e) {}
  }
  function onFirstGesture() {
    if (userReady) return;
    userReady = true;
    SEGMENTS.forEach(s => primeVideo(s.video));
  }
  on(window, 'pointerdown', onFirstGesture, { once: true, passive: true });
  on(window, 'touchstart', onFirstGesture, { once: true, passive: true });

  // Particles are a per-frame cost we can't afford alongside video scrubbing on a phone.
  seedParticles(particles, reduce || coarse);
  function onScroll() {
    if (destroyed) return;
    if (!ticking) { ticking = true; requestAnimationFrame(read); }
    // The magnet. Scrolling itself is native and free — the wheel and the finger
    // drive the camera one to one — and only when it stops does the page ease onto
    // the nearest station, so nobody is left parked mid-flight or mid-dissolve.
    // A trackpad's momentum tail keeps firing scroll events and so keeps resetting
    // this timer, which is what makes the settle wait for the gesture to be
    // genuinely over. Short and distance-scaled: this lands the visitor's own
    // gesture rather than taking them for a ride, and anything slow enough to
    // notice reads as lag.
    if (SNAP && !tween) armMagnet();
  }
  // The magnet, factored out so a finger lift can re-arm it. A touch that is still
  // down produces no scroll events while it holds still, so without this the timer
  // would fire under a stationary finger and drag the page out from under it.
  function armMagnet() {
    if (!SNAP || touching) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (tween || touching || !stations.length) return;
      const y = window.scrollY || window.pageYOffset;
      const s = stations[nearestStation(y)];
      const d = Math.abs(s - y);
      if (d > 2) tweenTo(s, Math.min(1520, Math.max(640, (d / vh) * 1800)) * MAGNET_SCALE);
    }, MAGNET_MS);
  }
  on(window, 'scroll', onScroll, { passive: true });
  // Never fight a finger that's still down: the magnet is disarmed for the whole
  // gesture and only re-armed on lift, where the momentum tail then keeps pushing
  // the timer out until the flick has genuinely finished.
  // clearTimeout only kills a magnet that hasn't fired yet. One already in flight
  // keeps calling scrollTo every frame, which on a phone is the page dragging
  // itself out from under a finger that's just been put down — so drop the tween
  // token too and let the step loop retire itself.
  on(window, 'touchstart', () => { touching = true; tween = null; clearTimeout(settleTimer); }, { passive: true });
  on(window, 'touchend', () => { touching = false; armMagnet(); }, { passive: true });
  on(window, 'touchcancel', () => { touching = false; armMagnet(); }, { passive: true });
  // Mobile browsers fire `resize` every time the URL bar slides in/out. Re-running
  // layout() there rebuilds the track height and yanks the scroll position, so on
  // touch we ignore height-only changes and only relayout when the width actually
  // changes (rotation still comes through orientationchange). layout() records the
  // width it laid out at.
  //
  // Debounced, because dragging a desktop window narrow fires this continuously
  // and a variant switch tears down four decoders — doing that per pixel would be
  // a slideshow. 160ms is under the threshold where a resize feels unresponsive
  // and well over a drag's event rate.
  function onResize() {
    if (coarse && window.innerWidth === laidOutW) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (destroyed) return;
      if (isMobile() !== mobileNow) switchVariant();
      else layout();
    }, 160);
  }
  on(window, 'resize', onResize);
  on(window, 'orientationchange', () => { if (isMobile() !== mobileNow) switchVariant(); else layout(); });
  on(window, 'load', layout);

  // ---- station navigation --------------------------------------------------
  // Scrolling stays native: the wheel and the finger drive the camera directly,
  // one to one, so the flight responds while the gesture is happening. Stations
  // are magnetic rather than mandatory — when the gesture (and any momentum)
  // stops, the page eases onto the nearest one, so nobody is left parked
  // mid-flight or mid-dissolve. See the scroll listener for that settle.
  //
  // Keys are the exception: an arrow or a page key is a discrete request, so it
  // steps station to station.
  if (SNAP) {
    on(window, 'keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
      const k = e.key;
      if (k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Spacebar') { e.preventDefault(); gotoStation(1); }
      else if (k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); gotoStation(-1); }
      else if (k === 'Home') { e.preventDefault(); tweenTo(stations[0]); }
      else if (k === 'End') { e.preventDefault(); tweenTo(stations[stations.length - 1]); }
    });
  }

  // ---- in-film links into the rest of the site -------------------------------
  // A CTA pointing at a same-origin path (the shop) must not reload the document:
  // that would drop the whole preloaded film and put the visitor back behind the
  // loading gate on their way back. The engine can't know the host's router, so
  // it emits `scrollworld:navigate` with the href and lets the host handle it —
  // and falls back to the anchor's own default if nobody does.
  on(container, 'click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest('a[data-sw-nav]') : null;
    if (!a || !container.contains(a)) return;
    const ev = new CustomEvent('scrollworld:navigate', {
      detail: { href: a.getAttribute('href') }, cancelable: true,
    });
    // Handled means the host routed it; unhandled means let the browser do it.
    if (!window.dispatchEvent(ev)) e.preventDefault();
  });

  layout();
  // Pull the film down at mount so the first scroll already has frames to scrub.
  // The host page holds its loading screen until onReady fires. With a `preloadGate`
  // only that many clips are in this wave; announceReady kicks off the rest.
  if (PRELOAD) clipSegs.forEach(s => { if (s._gated) loadClip(s); });
  requestAnimationFrame(raf);

  // Hand the caller a way out. A single-page app MUST call this when it unmounts
  // the container: the listeners above are on the window, so without it the snap
  // magnet and the key handler keep running on whatever page comes next.
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    bound.forEach(off => off());
    bound.length = 0;
    cancelAutoScroll();
    clearTimeout(settleTimer);
    clearTimeout(resizeTimer);
    tween = null;                // in-flight tweenTo checks this and bails
    // Release the decoders and the blob URLs; the container's DOM is about to go.
    SEGMENTS.forEach(s => {
      const v = s.video;
      if (!v) return;
      try {
        v.pause();
        if (v.src && v.src.startsWith('blob:')) URL.revokeObjectURL(v.src);
        v.removeAttribute('src');
        v.load();
      } catch (e) {}
    });
    blobCache.clear();
    container.innerHTML = '';
    container.classList.remove('sw-root');
  }
  return { destroy };

  // ---- helpers ----
  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }
  function pad(n) { return String(n).padStart(2, '0'); }
  // Shared body of a copy block, used for both a section's own copy and its
  // optional `intro`. The section variant prepends its own NN / NN counter.
  function copyHTML(c) {
    return (c.eyebrow ? `<span class="sw-copy__eyebrow">${esc(c.eyebrow)}</span>` : '') +
      (c.title ? `<h2 class="sw-copy__title">${esc(c.title)}</h2>` : '') +
      (c.body ? `<p class="sw-copy__body">${esc(c.body)}</p>` : '') +
      (c.tags && c.tags.length ? `<ul class="sw-copy__tags">${c.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '') +
      (c.cta ? `<div class="sw-copy__cta">${ctaBtns(c.cta)}</div>` : '');
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function ctaBtns(cta) {
    let h = '';
    if (cta.primary) h += btn('sw-btn--primary', cta.primary);
    if (cta.secondary) h += btn('sw-btn--ghost', cta.secondary);
    return h;
  }
  // Real anchors, always — middle-click and open-in-new-tab have to keep working.
  // Same-origin paths additionally get data-sw-nav, which the delegated handler
  // below turns into an event the host's router can take, so a CTA into the shop
  // is a route change and not a full reload of a 40MB film.
  function btn(cls, c) {
    const href = c.href || '#';
    const internal = /^\/(?!\/)/.test(href) ? ' data-sw-nav' : '';
    return `<a class="sw-btn ${cls}" href="${esc(href)}"${internal}>${esc(c.label)}</a>`;
  }
}

function seedParticles(host, reduce) {
  if (!host || reduce) return;
  const kinds = ['dot', 'dot', 'ring'];
  const seeds = [7, 23, 41, 58, 71, 88, 12, 34, 52, 66, 83, 95, 18, 29, 47, 63, 77, 91, 5, 38, 55, 69, 82, 97];
  for (let k = 0; k < 20; k++) {
    const s = document.createElement('span');
    s.className = 'sw-pt sw-pt--' + kinds[k % kinds.length];
    s.style.left = seeds[k % seeds.length] + 'vw';
    s.style.top = ((seeds[(k * 3) % seeds.length] * 1.3) % 100) + 'vh';
    s.style.setProperty('--sw-sc', (0.5 + ((seeds[(k * 5) % seeds.length] % 60) / 60) * 1.1).toFixed(2));
    const dur = 14 + (seeds[(k * 7) % seeds.length] % 22);
    s.style.animationDuration = dur + 's';
    s.style.animationDelay = (-(seeds[(k * 2) % seeds.length] % dur)) + 's';
    host.appendChild(s);
  }
}

function injectCSS() {
  if (document.getElementById('sw-css')) return;
  const css = `
  .sw-root{--sw-bg:#F5EDE0;--sw-ink:#241d2b;--sw-ink-soft:#6a6072;--sw-accent:#8a7bb5;
    --sw-font-display:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif;
    --sw-font-body:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
    color:var(--sw-ink);font-family:var(--sw-font-body);}
  html,body{margin:0;background:var(--sw-bg,#F5EDE0);overflow-x:hidden;}
  .sw-sky{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:var(--sw-bg);}
  .sw-sky__grad{position:absolute;inset:-10%;background:linear-gradient(178deg,color-mix(in srgb,var(--sw-accent) 12%,var(--sw-bg)) 0%,var(--sw-bg) 55%,color-mix(in srgb,var(--sw-accent) 6%,var(--sw-bg)) 100%);}
  .sw-sky__glow{position:absolute;inset:0;background:radial-gradient(60% 42% at 74% 16%,color-mix(in srgb,var(--sw-accent) 22%,transparent),transparent 70%),radial-gradient(46% 34% at 50% 50%,color-mix(in srgb,#fff 45%,transparent),transparent 70%);}
  .sw-particles{position:absolute;inset:-6% -2%;will-change:transform;}
  .sw-pt{position:absolute;width:13px;height:13px;transform:scale(var(--sw-sc,1));opacity:0;animation:sw-drift linear infinite;}
  .sw-pt::before{content:"";position:absolute;inset:0;border-radius:50%;}
  .sw-pt--dot::before{background:radial-gradient(circle at 34% 30%,color-mix(in srgb,var(--sw-accent) 60%,#000),#000 82%);}
  .sw-pt--ring::before{background:transparent;border:2px solid color-mix(in srgb,var(--sw-accent) 55%,transparent);}
  @keyframes sw-drift{0%{opacity:0;transform:scale(var(--sw-sc)) translate(0,12vh) rotate(0)}12%{opacity:.5}88%{opacity:.45}100%{opacity:0;transform:scale(var(--sw-sc)) translate(4vw,-22vh) rotate(210deg)}}
  .sw-scrollbar{position:fixed;top:0;left:0;right:0;height:3px;z-index:60;background:color-mix(in srgb,var(--sw-accent) 14%,transparent);}
  .sw-scrollbar span{display:block;height:100%;width:100%;transform-origin:0 50%;transform:scaleX(0);background:var(--sw-accent);}
  .sw-topbar{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:clamp(14px,2.4vw,26px) clamp(18px,5vw,64px);}
  .sw-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--sw-ink);}
  .sw-brand__mark{width:24px;height:28px;border-radius:7px 7px 10px 10px;background:linear-gradient(160deg,var(--sw-accent),color-mix(in srgb,var(--sw-accent) 60%,#000));box-shadow:0 6px 14px color-mix(in srgb,var(--sw-accent) 40%,transparent);}
  .sw-brand__name{font-family:var(--sw-font-display);font-weight:700;font-size:1.1rem;}
  .sw-nav{display:flex;gap:4px;padding:5px;background:color-mix(in srgb,#fff 55%,transparent);backdrop-filter:blur(10px);border:1px solid color-mix(in srgb,var(--sw-accent) 16%,transparent);border-radius:999px;}
  .sw-nav__item{font:inherit;font-size:.82rem;color:var(--sw-ink-soft);border:0;background:transparent;cursor:pointer;padding:7px 14px;border-radius:999px;transition:color .25s,background .25s;}
  .sw-nav__item:hover{color:var(--sw-ink);} .sw-nav__item.is-active{color:#fff;background:var(--sw-accent);}
  .sw-topcta{text-decoration:none;font-weight:600;font-size:.9rem;color:#fff;background:var(--sw-ink);padding:10px 20px;border-radius:999px;white-space:nowrap;}
  .sw-stage{position:fixed;inset:0;z-index:10;pointer-events:none;}
  /* will-change only on the scenes that are actually on screen (read() toggles
     is-live). Pinning a composited layer per scene for the whole session costs a
     full-viewport GPU surface each, which is what runs a phone out of memory. */
  .sw-scene{position:absolute;inset:0;opacity:0;overflow:hidden;contain:paint;}
  .sw-scene.is-live{will-change:opacity;}
  .sw-scene__video,.sw-scene__still{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 42%;}
  .sw-scene.is-live .sw-scene__still{will-change:transform;}
  .sw-scene.has-clip .sw-scene__still{opacity:0;} .sw-scene__video{z-index:1;}
  .sw-copylayer{position:fixed;inset:0;z-index:20;pointer-events:none;}
  .sw-copylayer::before{content:"";position:absolute;inset:0;width:min(58vw,780px);background:linear-gradient(90deg,var(--sw-bg) 0%,color-mix(in srgb,var(--sw-bg) 82%,transparent) 34%,color-mix(in srgb,var(--sw-bg) 40%,transparent) 62%,transparent 100%);}
  /* Bounded box, not a centred point: top/bottom insets keep the block inside the
     safe band between the topbar and the scroll hint, so a tall block (the closing
     scene carries eyebrow + title + body + CTA) grows into the available height
     instead of hanging off the bottom with its call to action cut off.

     Anchored to the TOP of that band rather than centred within it. Centring makes
     every scene's counter, eyebrow and title start at a different height, because
     each block is a different length — so stepping from stop to stop slides the
     type up and down against a camera that is meanwhile holding still. Anchored,
     the three of them land on exactly the same line every time and only the body
     below them changes depth. The parallax offset arrives as --sw-shift so this
     transform is never replaced inline. */
  .sw-copy{position:absolute;left:clamp(18px,5vw,64px);top:clamp(140px,20vh,184px);bottom:clamp(72px,12vh,116px);
    width:min(42vw,460px);display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;
    opacity:0;transform:translateY(var(--sw-shift,0vh));will-change:opacity,transform;}
  .sw-copy--intro .sw-copy__title{font-size:clamp(2.3rem,5vw,3.9rem);}
  .sw-copy__num{font-family:ui-monospace,Menlo,monospace;font-size:.74rem;letter-spacing:.12em;color:var(--sw-ink-soft);}
  .sw-copy__eyebrow{display:block;margin-top:18px;font-family:var(--sw-font-display);font-weight:700;font-size:.8rem;letter-spacing:.16em;text-transform:uppercase;color:var(--sw-accent);}
  .sw-copy__title{font-family:var(--sw-font-display);font-weight:700;color:var(--sw-ink);font-size:clamp(2rem,4.4vw,3.5rem);line-height:1.03;margin:12px 0 0;letter-spacing:-.01em;text-shadow:0 2px 20px color-mix(in srgb,var(--sw-bg) 70%,transparent);}
  .sw-copy__body{margin-top:18px;font-size:clamp(1rem,1.25vw,1.14rem);line-height:1.55;color:color-mix(in srgb,var(--sw-ink) 78%,var(--sw-ink-soft));max-width:40ch;text-shadow:0 1px 12px color-mix(in srgb,var(--sw-bg) 90%,transparent);}
  .sw-copy__tags{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin:24px 0 0;padding:0;}
  .sw-copy__tags li{font-size:.82rem;font-weight:600;color:color-mix(in srgb,var(--sw-accent) 70%,#000);padding:7px 14px;border-radius:999px;background:color-mix(in srgb,var(--sw-accent) 14%,#fff);border:1px solid color-mix(in srgb,var(--sw-accent) 30%,transparent);}
  /* No pointer-events here: read() turns the whole .sw-copy block on only inside
     its own hold window, and a child forcing auto would make every CTA in the
     film a live tap target behind the scene you are actually looking at — which
     on a phone is five bottom-anchored blocks stacked in the same strip. */
  .sw-copy__cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px;}
  .sw-btn{text-decoration:none;font-weight:600;font-size:.95rem;padding:13px 24px;border-radius:999px;transition:transform .2s;}
  .sw-btn--primary{color:#fff;background:var(--sw-ink);} .sw-btn--primary:hover{transform:translateY(-2px);}
  .sw-btn--ghost{color:var(--sw-ink);border:1.5px solid color-mix(in srgb,var(--sw-ink) 25%,transparent);} .sw-btn--ghost:hover{transform:translateY(-2px);}
  .sw-route{position:fixed;right:clamp(14px,2.4vw,30px);top:50%;z-index:40;transform:translateY(-50%);display:flex;flex-direction:column;gap:22px;padding:18px 10px;}
  .sw-route::before{content:"";position:absolute;left:50%;top:22px;bottom:22px;width:2px;transform:translateX(-50%);background:var(--sw-accent);opacity:.28;}
  .sw-route__dot{position:relative;border:0;background:transparent;cursor:pointer;width:14px;height:14px;display:grid;place-items:center;}
  .sw-route__dot i{width:9px;height:9px;border-radius:50%;background:color-mix(in srgb,var(--sw-accent) 40%,transparent);transition:transform .3s,background .3s,box-shadow .3s;}
  .sw-route__dot:hover i{transform:scale(1.25);background:var(--sw-accent);}
  .sw-route__dot.is-active i{background:var(--sw-accent);transform:scale(1.4);box-shadow:0 0 0 5px color-mix(in srgb,var(--sw-accent) 22%,transparent);}
  .sw-route__label{position:absolute;right:24px;top:50%;transform:translateY(-50%) translateX(6px);white-space:nowrap;font-size:.78rem;font-weight:600;color:var(--sw-ink);background:color-mix(in srgb,#fff 85%,transparent);backdrop-filter:blur(6px);padding:5px 11px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;border:1px solid color-mix(in srgb,var(--sw-accent) 14%,transparent);}
  .sw-route__dot:hover .sw-route__label,.sw-route__dot.is-active .sw-route__label{opacity:1;transform:translateY(-50%) translateX(0);}
  .sw-hint{position:fixed;left:50%;bottom:26px;z-index:30;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:10px;font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;color:var(--sw-ink-soft);transition:opacity .3s;}
  .sw-hint i{width:22px;height:34px;border-radius:12px;border:2px solid color-mix(in srgb,var(--sw-ink) 28%,transparent);position:relative;}
  .sw-hint i::after{content:"";position:absolute;left:50%;top:7px;width:4px;height:7px;border-radius:2px;background:var(--sw-accent);transform:translateX(-50%);animation:sw-wheel 1.7s ease-in-out infinite;}
  @keyframes sw-wheel{0%{opacity:0;top:6px}40%{opacity:1}100%{opacity:0;top:17px}}
  .sw-track{position:relative;z-index:1;width:100%;pointer-events:none;}
  @media (max-width:860px){
    /* The topbar wraps: row one is the brand and whatever actions survive at this
       width, row two is the stops. Top padding clears a notch. */
    .sw-topbar{flex-wrap:wrap;row-gap:8px;padding:calc(clamp(10px,3vw,18px) + env(safe-area-inset-top)) clamp(14px,4vw,24px) 0;}
    /* The stops become a swipeable row rather than folding into a hamburger. Five
       short labels fit a thumb flick, and a menu you have to open hides the only
       map of the film there is. */
    .sw-nav{display:flex;order:3;flex-basis:100%;max-width:100%;gap:2px;
      overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;
      scroll-snap-type:x proximity;scrollbar-width:none;}
    .sw-nav::-webkit-scrollbar{width:0;height:0;display:none;}
    /* 44px minimum on the pills: the padding is set by the type, which lands them
       at 34-37px — a cursor hits that, a thumb in a swipeable row does not. */
    .sw-nav__item{flex:0 0 auto;scroll-snap-align:center;padding:8px 13px;font-size:.78rem;min-height:44px;}
    .sw-topcta{font-size:.82rem;padding:9px 16px;display:inline-flex;align-items:center;min-height:44px;}
    .sw-copylayer::before{width:100%;height:60%;top:auto;bottom:0;background:linear-gradient(0deg,var(--sw-bg) 8%,color-mix(in srgb,var(--sw-bg) 70%,transparent) 46%,transparent 100%);}
    /* Anchor copy to the bottom, clear of the home indicator / collapsing URL bar.
       dvh + env() are progressive: browsers that lack them keep the vh fallback line. */
    .sw-copy{left:clamp(18px,5vw,64px);right:clamp(18px,5vw,64px);top:auto;bottom:clamp(64px,14vh,120px);width:auto;max-width:560px;justify-content:flex-end;}
    .sw-copy{bottom:calc(clamp(56px,12dvh,110px) + env(safe-area-inset-bottom));}
    .sw-copy__title{font-size:clamp(1.9rem,7.5vw,2.7rem);}
    .sw-copy__body{max-width:none;font-size:clamp(.98rem,3.6vw,1.1rem);} .sw-scene__video,.sw-scene__still{object-position:center 46%;}
    .sw-hint{bottom:calc(20px + env(safe-area-inset-bottom));}
    .sw-route{gap:16px;right:6px;} .sw-route__label{display:none;}
  }
  /* Portrait phones crop a 16:9 clip hard; keep the framing centred so the focal
     subject (which the camera dives toward) stays in view. */
  @media (max-width:860px) and (orientation:portrait){
    .sw-scene__video,.sw-scene__still{object-position:center 44%;}
  }
  /* A phone in landscape has ~400px of height to fit a wrapped topbar, a copy
     block and the hint. Drop the stops row (the copy is what matters here) and
     tighten the type rather than letting the CTA fall off the bottom. */
  @media (max-width:900px) and (max-height:520px) and (orientation:landscape){
    .sw-nav{display:none;}
    .sw-copy{bottom:calc(12px + env(safe-area-inset-bottom));top:auto;}
    .sw-copy__title{font-size:clamp(1.4rem,4.4vh,1.9rem);}
    .sw-copy__body{font-size:.92rem;margin-top:8px;}
    .sw-copy__cta{margin-top:12px;} .sw-hint{display:none;}
  }
  /* The 44px floor belongs to the pointer, not the viewport: an iPad in
     landscape and a touchscreen laptop are both well past 860px and still get a
     thumb. The mobile block above sets the same floor for a narrow window with a
     mouse, where the pills are packed into a swipeable row. */
  @media (pointer:coarse){
    .sw-nav__item{min-height:44px;}
    .sw-topcta{display:inline-flex;align-items:center;min-height:44px;}
  }
  /* Touch: give the route dots a finger-sized hit area without growing the visible dot. */
  @media (hover:none) and (pointer:coarse){
    .sw-route{padding:14px 6px;}
    .sw-route__dot{width:28px;height:28px;}
    .sw-btn{padding:15px 26px;}
  }
  /* Short viewports (laptops at 1280x720, phones in landscape) are where a tall
     copy block runs out of room first. Compress the vertical rhythm rather than
     letting the tail of the block — the CTA — fall outside the safe band. */
  @media (max-height:900px){
    .sw-copy__eyebrow{margin-top:10px;}
    .sw-copy__title{font-size:clamp(1.7rem,3.4vw,2.5rem);margin-top:8px;}
    .sw-copy--intro .sw-copy__title{font-size:clamp(1.9rem,4vw,3rem);}
    .sw-copy__body{margin-top:12px;font-size:1rem;}
    .sw-copy__tags{margin-top:14px;} .sw-copy__tags li{padding:5px 11px;}
    .sw-copy__cta{margin-top:18px;} .sw-btn{padding:11px 20px;}
  }
  @media (prefers-reduced-motion:reduce){ .sw-hint i::after{animation:none;} .sw-pt{display:none;} }
  `;
  // Wrap in a cascade layer so the page's own theme tokens (unlayered
  // :root / .sw-root { --sw-bg / --sw-ink / --sw-accent … }) always win over
  // these defaults, regardless of injection order. Enables clean dark themes.
  const style = document.createElement('style'); style.id = 'sw-css';
  style.textContent = '@layer sw {\n' + css + '\n}';
  document.head.appendChild(style);
}

// Expose for module + global use.
if (typeof module !== 'undefined' && module.exports) module.exports = { mountScrollWorld };
if (typeof window !== 'undefined') window.mountScrollWorld = mountScrollWorld;
