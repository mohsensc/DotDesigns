/* ============================================================================
   scroll-world — portable scroll-scrubbed camera-flight engine
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
         so a 720p, -g 4 file scrubs far smoother than the 1080p desktop master; see
         pipeline.md). Falls back to the desktop `clip` if no mobile variant is given.
       - uses `stillMobile` as the scene poster when provided (pair it with native 9:16
         clipMobile renders so the poster matches the portrait video's first frame instead
         of flashing from a landscape crop). Chosen once at mount; a desktop resize into
         phone width keeps the desktop poster (clips still switch via isMobile()).
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
     - clips encoded native-res, crf~20, -g 8, +faststart, no audio (see pipeline.md)
     - connectors' endpoints are the neighbouring dives' ACTUAL frames (see SKILL Step 5)
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
  const DIVE_W = config.diveScroll || 1.3;
  const CONN_W = config.connScroll || 0.9;
  const CROSSFADE = (config.crossfade != null) ? config.crossfade : 0.12;  // seam dissolve width (vh)
  // HOLD — trailing fraction of a dive's scroll range where the clip is parked on
  // its final (arrival) frame instead of still scrubbing. This is what creates a
  // second stable resting frame per scene: the flight completes, then the camera
  // sits still while the copy is read. 0 = the old behaviour (scrub to the seam).
  const HOLD = Math.min(0.8, Math.max(0, config.hold != null ? config.hold : 0));
  // SNAP — station-to-station navigation. With it on, the only scroll positions a
  // visitor can come to rest at are the stations (each scene's opening frame and
  // its arrival frame); every position between them is traversed by an animated
  // tween, so a flight or a seam dissolve always completes rather than being
  // dragged through by hand. Opt-in.
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
  // Multiplier on how long a step between stations takes. 1 = the default pace;
  // 3 runs the transitions at a third of that speed.
  const STEP_SCALE = config.stepScale > 0 ? config.stepScale : 1;
  const N = SECTIONS.length;
  if (!N) return;

  injectCSS();
  container.classList.add('sw-root');

  // ---- build the interleaved segment chain: dive0, conn0, dive1, … diveN-1 ----
  const SEGMENTS = [];
  SECTIONS.forEach((s, i) => {
    const dive = { kind: 'dive', si: i, clip: s.clip, clipM: s.clipMobile, still: s.still, stillM: s.stillMobile,
                   accent: s.accent, w: s.scroll || DIVE_W, linger: s.linger || 0, range: s.range,
                   settle: s.settle };
    SEGMENTS.push(dive);
    s._seg = dive;
    // A connector is optional: if connectors[i] is falsy, the two dives simply
    // crossfade directly (no fly-over). Lets a page complete even when a
    // connector can't be generated (e.g. a content-filter false-positive).
    if (i < N - 1 && CONNECTORS[i]) {
      SEGMENTS.push({ kind: 'conn', si: i, clip: CONNECTORS[i], clipM: CONNECTORS_M[i],
                      still: SECTIONS[i + 1].still, stillM: SECTIONS[i + 1].stillMobile,
                      accent: SECTIONS[i + 1].accent, w: CONN_W });
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
  if (config.brand) {
    const brand = el('a', 'sw-brand'); brand.href = (config.brand.href || '#');
    brand.appendChild(el('span', 'sw-brand__mark'));
    const nm = el('span', 'sw-brand__name'); nm.textContent = config.brand.name || ''; brand.appendChild(nm);
    topbar.appendChild(brand);
  }
  const nav = el('nav', 'sw-nav'); if (config.nav !== false) topbar.appendChild(nav);
  if (config.cta && config.cta.label) {
    const c = el('a', 'sw-topcta'); c.href = config.cta.href || '#'; c.textContent = config.cta.label;
    topbar.appendChild(c);
  }

  const stage = el('div', 'sw-stage');
  const copylayer = el('div', 'sw-copylayer');
  const route = el('div', 'sw-route');
  const hint = el('div', 'sw-hint');
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
    const poster = (isMobile() && s.stillM) ? s.stillM : s.still;
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
    c.innerHTML = `<span class="sw-copy__num">${pad(i + 1)} / ${pad(N)}</span>` + copyHTML(s);
    copylayer.appendChild(c); copies.push(c);

    let ic = null;
    if (s.intro) {
      ic = el('article', 'sw-copy sw-copy--intro'); ic.style.setProperty('--sw-accent', s.accent || '');
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
  const FLIGHT_END = HOLD > 0 ? (1 - HOLD) * 0.68 : 1;
  const HOLD_END = HOLD > 0 ? FLIGHT_END + HOLD : 1;
  function segProgress(s, local) {
    if (HOLD <= 0 || s.kind !== 'dive') return s.linger ? lingerEase(local, s.linger) : local;
    const settle = (s.settle != null) ? clamp(s.settle) : 1;
    if (local <= FLIGHT_END) {
      const x = FLIGHT_END > 0 ? local / FLIGHT_END : 1;
      return (s.linger ? lingerEase(x, s.linger) : x) * settle;
    }
    if (local <= HOLD_END) return settle;
    return settle + ((local - HOLD_END) / Math.max(1e-4, 1 - HOLD_END)) * (1 - settle);
  }
  let vh = window.innerHeight, stageX = 0, totalW = 0, activeIndex = -1, ticking = false;
  let laidOutW = window.innerWidth;   // width the current layout was computed at (see onResize)
  let stations = [], tween = null, inputLock = 0, settleTimer = 0;

  function layout() {
    vh = window.innerHeight;
    laidOutW = window.innerWidth;
    stageX = window.innerWidth > 860 ? 4 : 0;
    let off = 0;
    SEGMENTS.forEach(s => { s.start = off * vh; off += s.w; s.end = off * vh; });
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

  // ---- readiness accounting (drives the host page's loading gate) -----------
  // A clip counts as settled once it is decodable (metadata in) or has failed for
  // good. Failures still count so a single missing file can never wedge a page
  // that is waiting on onReady before it reveals itself.
  const clipSegs = SEGMENTS.filter(s => s.clip);
  let settledClips = 0, announcedReady = false;
  function announceReady() {
    if (announcedReady) return;
    announcedReady = true;
    if (config.onReady) { try { config.onReady(); } catch (e) {} }
  }
  function noteSettled() {
    settledClips++;
    if (config.onProgress) { try { config.onProgress(settledClips, clipSegs.length); } catch (e) {} }
    if (settledClips >= clipSegs.length) announceReady();
  }
  // Reduced motion never loads a clip, and a config with no clips has nothing to
  // wait for; in both cases the page is ready as soon as it is mounted.
  if (reduce || !clipSegs.length) {
    if (config.onProgress) { try { config.onProgress(clipSegs.length, clipSegs.length); } catch (e) {} }
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
  function rangeOf(s) {
    const r = s.range;
    if (!r || r.length !== 2) return [0, 1];
    const a = clamp(r[0]), b = clamp(r[1]);
    return b > a ? [a, b] : [0, 1];
  }

  function loadClip(s) {
    // Under prefers-reduced-motion we never load the clips at all — the stills stay up
    // and simply cross-dissolve as you scroll. No scrubbed video motion, no decode cost.
    if (reduce || s.loading || !s.clip) return;
    s.loading = true;
    // Serve the lighter mobile encode on phones when one was provided.
    const url = (isMobile() && s.clipM) ? s.clipM : s.clip;
    fetchClip(url)
      .then(blob => {
        const v = document.createElement('video');
        v.className = 'sw-scene__video';
        v.muted = true; v.playsInline = true; v.preload = 'auto';
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
          noteSettled();
          read();
        });
        // Reveal the video (hide the still poster) only once a real frame has
        // painted — on iOS a seeked-but-never-played muted video stays blank, so
        // hiding the still on metadata alone would flash an empty scene.
        v.addEventListener('seeked', () => { s.el.classList.add('has-clip'); }, { once: true });
        v.addEventListener('loadeddata', () => { try { v.pause(); } catch (e) {} if (userReady) primeVideo(v); });
        s.el.appendChild(v); s.video = v; s.hasClip = true;
      }).catch(() => { s.loading = false; noteSettled(); });
  }

  function read() {
    const y = window.scrollY || window.pageYOffset;
    const fade = CROSSFADE * vh;
    let ci = 0;
    for (let i = 0; i < NSEG; i++) if (y >= SEGMENTS[i].start) ci = i;

    for (let i = 0; i < NSEG; i++) {
      const s = SEGMENTS[i];
      if (!PRELOAD && y > s.start - 1.6 * vh && y < s.end + 1.6 * vh) loadClip(s);
      const local = clamp((y - s.start) / (s.end - s.start), 0, 1);
      const flight = segProgress(s, local);
      s.target = flight;
      let outside = 0;
      if (y < s.start) outside = s.start - y; else if (y > s.end) outside = y - s.end;
      const op = smooth(1 - outside / fade);
      s.el.style.opacity = op; s.visible = op > 0.001;
      s.el.style.zIndex = (i === ci) ? '120' : String(100 + Math.round(op * 10));
      if (!s.hasClip || !s.ready) {
        const sc = reduce ? 1 : 1.03 + flight * 0.14;
        s.img.style.transform = `translateX(${stageX - 2}vw) scale(${sc.toFixed(3)})`;
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
      c.style.opacity = cop;
      // Parallax is published as a custom property, never as an inline transform:
      // the stylesheet owns the block's centring transform, and an inline one
      // would replace it (dropping translateY(-50%)) and push tall blocks such as
      // the closing CTA off the bottom of the viewport.
      c.style.setProperty('--sw-shift', reduce ? '0vh' : ((0.5 - pr) * 4).toFixed(3) + 'vh');
      c.style.pointerEvents = cop > 0.5 ? 'auto' : 'none';

      const ic = intros[i];
      if (ic) {
        const icop = (before || after) ? 0 : smooth(1 - pr / Math.max(1e-4, rise0 * 0.72));
        ic.style.opacity = icop;
        ic.style.setProperty('--sw-shift', reduce ? '0vh' : (-pr * 5).toFixed(3) + 'vh');
        ic.style.pointerEvents = icop > 0.5 ? 'auto' : 'none';
      }
    }

    const cur = SEGMENTS[ci];
    const near = clamp(cur.kind === 'dive' ? cur.si
      : (((y - cur.start) / (cur.end - cur.start)) > 0.5 ? cur.si + 1 : cur.si), 0, N - 1);
    if (near !== activeIndex) {
      activeIndex = near;
      dots.forEach((d, k) => d.classList.toggle('is-active', k === near));
      nav.querySelectorAll('.sw-nav__item').forEach((n, k) => n.classList.toggle('is-active', k === near));
      container.style.setProperty('--sw-accent', SECTIONS[near].accent || '');
    }
    scrollbarFill.style.transform = `scaleX(${clamp(y / (totalW * vh))})`;
    hint.style.opacity = clamp(1 - y / (0.5 * vh));
    if (particles) particles.style.transform = `translate3d(0, ${-y * 0.05}px, 0)`;
    ticking = false;
  }

  function raf() {
    const eps = isMobile() ? 0.02 : 0.008;   // coarser seek step on phones = fewer decodes
    for (let i = 0; i < NSEG; i++) {
      const s = SEGMENTS[i];
      if (!s.hasClip || !s.ready || !s.video) continue;
      // Never queue a seek while the decoder is still resolving the last one.
      // On phones a fast flick would otherwise pile up seeks and freeze the clip;
      // cur keeps lerping, so we snap to the latest target the moment it's free.
      if (s.video.seeking) continue;
      if (!s.visible && Math.abs(s.cur - s.target) < 0.002) continue;
      s.cur += (s.target - s.cur) * (reduce ? 1 : 0.18);
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
    if (!isMobile() || !v) return;
    try { const p = v.play(); if (p && p.then) p.then(() => { try { v.pause(); } catch (e) {} }).catch(() => {}); }
    catch (e) {}
  }
  function onFirstGesture() {
    if (userReady) return;
    userReady = true;
    SEGMENTS.forEach(s => primeVideo(s.video));
  }
  window.addEventListener('pointerdown', onFirstGesture, { once: true, passive: true });
  window.addEventListener('touchstart', onFirstGesture, { once: true, passive: true });

  // Particles are a per-frame cost we can't afford alongside video scrubbing on a phone.
  seedParticles(particles, reduce || coarse);
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(read); }
    // The magnet. Scrolling itself is native and free — the wheel and the finger
    // drive the camera one to one — and only when it stops does the page ease onto
    // the nearest station, so nobody is left parked mid-flight or mid-dissolve.
    // A trackpad's momentum tail keeps firing scroll events and so keeps resetting
    // this timer, which is what makes the settle wait for the gesture to be
    // genuinely over. Short and distance-scaled: this lands the visitor's own
    // gesture rather than taking them for a ride, and anything slow enough to
    // notice reads as lag.
    if (SNAP && !tween) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (tween || !stations.length) return;
        const y = window.scrollY || window.pageYOffset;
        const s = stations[nearestStation(y)];
        const d = Math.abs(s - y);
        if (d > 2) tweenTo(s, Math.min(760, Math.max(320, (d / vh) * 900)));
      }, 140);
    }
  }, { passive: true });
  // Mobile browsers fire `resize` every time the URL bar slides in/out. Re-running
  // layout() there rebuilds the track height and yanks the scroll position, so on
  // touch we ignore height-only changes and only relayout when the width actually
  // changes (rotation still comes through orientationchange). layout() records the
  // width it laid out at.
  function onResize() {
    if (coarse && window.innerWidth === laidOutW) return;
    layout();
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', layout);
  window.addEventListener('load', layout);

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
    window.addEventListener('keydown', e => {
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

  layout();
  // Pull the whole film down at mount so the first scroll already has frames to
  // scrub. The host page holds its loading screen until onReady fires.
  if (PRELOAD) SEGMENTS.forEach(loadClip);
  requestAnimationFrame(raf);

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
    if (cta.primary) h += `<a class="sw-btn sw-btn--primary" href="${esc(cta.primary.href || '#')}">${esc(cta.primary.label)}</a>`;
    if (cta.secondary) h += `<a class="sw-btn sw-btn--ghost" href="${esc(cta.secondary.href || '#')}">${esc(cta.secondary.label)}</a>`;
    return h;
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
  .sw-scene{position:absolute;inset:0;opacity:0;overflow:hidden;will-change:opacity;}
  .sw-scene__video,.sw-scene__still{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 42%;}
  .sw-scene__still{will-change:transform;} .sw-scene.has-clip .sw-scene__still{opacity:0;} .sw-scene__video{z-index:1;}
  .sw-copylayer{position:fixed;inset:0;z-index:20;pointer-events:none;}
  .sw-copylayer::before{content:"";position:absolute;inset:0;width:min(58vw,780px);background:linear-gradient(90deg,var(--sw-bg) 0%,color-mix(in srgb,var(--sw-bg) 82%,transparent) 34%,color-mix(in srgb,var(--sw-bg) 40%,transparent) 62%,transparent 100%);}
  /* Bounded box, not a centred point: top/bottom insets keep the block inside the
     safe band between the topbar and the scroll hint, and the content is centred
     within it. A tall block (the closing scene carries eyebrow + title + body +
     tags + CTA) therefore grows into the available height instead of hanging off
     the bottom of the viewport with its call to action cut off. The parallax
     offset arrives as --sw-shift so this transform is never replaced inline. */
  .sw-copy{position:absolute;left:clamp(18px,5vw,64px);top:clamp(140px,20vh,184px);bottom:clamp(72px,12vh,116px);
    width:min(42vw,460px);display:flex;flex-direction:column;align-items:flex-start;justify-content:center;
    opacity:0;transform:translateY(var(--sw-shift,0vh));will-change:opacity,transform;}
  .sw-copy--intro .sw-copy__title{font-size:clamp(2.3rem,5vw,3.9rem);}
  .sw-copy__num{font-family:ui-monospace,Menlo,monospace;font-size:.74rem;letter-spacing:.12em;color:var(--sw-ink-soft);}
  .sw-copy__eyebrow{display:block;margin-top:18px;font-family:var(--sw-font-display);font-weight:700;font-size:.8rem;letter-spacing:.16em;text-transform:uppercase;color:var(--sw-accent);}
  .sw-copy__title{font-family:var(--sw-font-display);font-weight:700;color:var(--sw-ink);font-size:clamp(2rem,4.4vw,3.5rem);line-height:1.03;margin:12px 0 0;letter-spacing:-.01em;text-shadow:0 2px 20px color-mix(in srgb,var(--sw-bg) 70%,transparent);}
  .sw-copy__body{margin-top:18px;font-size:clamp(1rem,1.25vw,1.14rem);line-height:1.55;color:color-mix(in srgb,var(--sw-ink) 78%,var(--sw-ink-soft));max-width:40ch;text-shadow:0 1px 12px color-mix(in srgb,var(--sw-bg) 90%,transparent);}
  .sw-copy__tags{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin:24px 0 0;padding:0;}
  .sw-copy__tags li{font-size:.82rem;font-weight:600;color:color-mix(in srgb,var(--sw-accent) 70%,#000);padding:7px 14px;border-radius:999px;background:color-mix(in srgb,var(--sw-accent) 14%,#fff);border:1px solid color-mix(in srgb,var(--sw-accent) 30%,transparent);}
  .sw-copy__cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px;pointer-events:auto;}
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
    .sw-nav{display:none;}
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
