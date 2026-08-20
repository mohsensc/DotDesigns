import { useEffect, useRef, useState } from "react";
import "./AmbientAudio.css";

// Quiet sound toggle for the World scroll flight. The track is real (11:38 of
// public-domain cello, ~2.8MB) but the homepage already preloads ~40MB of
// video behind a loading gate, so the Audio element is built lazily on the
// visitor's own first click — never at mount, never fetched up front.
const STORAGE_KEY = "dot.sound";
const TRACK_SRC = "/audio/dot-ambient.mp3";
const VOLUME = 0.28;

export default function AmbientAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Intent, tracked in a ref because the queued gesture handler below closes over
  // it and must see the current value, not the one from when it was registered.
  const wantsSound = useRef(false);
  const [on, setOn] = useState(false);

  // Built on demand, never at mount, so nothing is fetched until sound is wanted.
  const ensureAudio = () => {
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio(TRACK_SRC);
      audio.loop = true;
      audio.volume = VOLUME;
      audioRef.current = audio;
    }
    return audio;
  };

  // Reflect the remembered choice, and — since audible autoplay is blocked until
  // the visitor has interacted — queue playback on their next gesture, whatever
  // it is. Without this a returning visitor sees a lit button over silence, and
  // their first click on it would read as "off" and mute a track never playing.
  useEffect(() => {
    let remembered = false;
    try {
      remembered = window.localStorage.getItem(STORAGE_KEY) === "on";
    } catch {
      // localStorage unavailable (private mode, blocked) — default stays off.
    }
    if (!remembered) return;
    wantsSound.current = true;
    setOn(true);

    const events = ["pointerdown", "keydown", "touchstart"] as const;
    const stop = () => events.forEach(e => window.removeEventListener(e, start));
    function start() {
      stop(); // any one gesture is enough; drop the rest
      // They may have hit the toggle before gesturing anywhere else.
      if (!wantsSound.current) return;
      ensureAudio().play().catch(() => {});
    }
    events.forEach(e => window.addEventListener(e, start, { passive: true }));
    return stop;
  }, []);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
      }
      audioRef.current = null;
    };
  }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    wantsSound.current = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      // ignore — the toggle still works for this visit
    }

    if (next) {
      // Autoplay policies can still reject this even from a click in some
      // browsers (e.g. a synthetic event); fail quietly, the button stays lit.
      ensureAudio().play().catch(() => {});
    } else {
      audioRef.current?.pause();
    }
  };

  return (
    <button
      type="button"
      className="dot-sound"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Mute ambient music" : "Play ambient music"}
      title={on ? "Mute ambient music" : "Play ambient music"}
    >
      <svg className="dot-sound__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M4 9v6h4l5 5V4L8 9H4z" />
        {on ? (
          <path
            className="dot-sound__wave"
            d="M16.4 8.4a5.2 5.2 0 0 1 0 7.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        ) : (
          <path
            className="dot-sound__mute"
            d="M16.8 9.2l4.4 5.6M21.2 9.2l-4.4 5.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        )}
      </svg>
    </button>
  );
}
