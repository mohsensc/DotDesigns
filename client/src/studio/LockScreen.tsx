import { useEffect, useState, type FormEvent } from "react";

type Props = {
  onUnlocked: () => void;
  /** True when she was already in and the server dropped her. */
  sessionEnded?: boolean;
};

// Full-screen gate, shown on every load. The password itself never leaves this
// form — it's POSTed once and the server hands back a cookie, nothing else.
//
// Five wrong guesses and the server locks the studio. Then there's no password
// field at all, just the unlock code, which is a different secret and does not
// sign anyone in — it only lifts the lock.
export default function LockScreen({ onUnlocked, sessionEnded }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [lockdown, setLockdown] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [showUnlock, setShowUnlock] = useState(false);
  const [code, setCode] = useState("");

  // Only reads lockdown. Whether this browser has a session is deliberately
  // ignored: the studio is locked on every load and stays that way until she
  // types the password.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/studio-auth")
      .then(res => (res.ok ? res.json() : null))
      .then((body: { lockdown?: boolean } | null) => {
        if (!cancelled && body?.lockdown) setLockdown(true);
      })
      .catch(() => {
        // Nothing to show here — the next POST will say so.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setChecking(true);
    try {
      const res = await fetch("/api/studio-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword("");
        setRemaining(null);
        onUnlocked();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { lockdown?: boolean; remaining?: number };
      if (res.status === 423 || body.lockdown) {
        setPassword("");
        setLockdown(true);
      } else if (res.status === 500) {
        setError("This studio isn't set up yet. Ask whoever runs the site to finish setup.");
      } else {
        setRemaining(typeof body.remaining === "number" ? body.remaining : null);
        setError("That password isn't right. Try again.");
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }

  async function handleUnlock(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setChecking(true);
    try {
      const res = await fetch("/api/studio-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unlock: code }),
      });
      if (res.ok) {
        // Back to the password form. The code lifts the lock, it isn't a way in.
        setCode("");
        setShowUnlock(false);
        setLockdown(false);
        setRemaining(null);
        return;
      }
      // 503 is the server saying storage is down, not that the code is wrong.
      setError(res.status === 503 ? "Couldn't reach storage. Try again." : "That code isn't right.");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }

  if (lockdown) {
    return (
      <div className="lock-screen">
        <div className="lock-card">
          <h1>Dot Designs Studio</h1>
          <p className="lock-hint">Ask Mohsen to unlock the website.</p>
          {showUnlock ? (
            <form onSubmit={handleUnlock}>
              <label className="lock-label" htmlFor="studio-unlock">
                Unlock code
              </label>
              <input
                id="studio-unlock"
                type="password"
                autoFocus
                autoComplete="off"
                value={code}
                onChange={e => setCode(e.target.value)}
                className="lock-input"
              />
              {error && <p className="lock-error">{error}</p>}
              <button type="submit" className="btn btn-primary lock-submit" disabled={checking || !code}>
                {checking ? "Checking…" : "Unlock"}
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="lock-plain-btn"
              style={{ background: "none", border: 0, padding: 0, font: "inherit", fontSize: 14, textDecoration: "underline", cursor: "pointer" }}
              onClick={() => setShowUnlock(true)}
            >
              I'm Mohsen
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={handleSubmit}>
        <h1>Dot Designs Studio</h1>
        {sessionEnded ? (
          <p className="lock-hint">Your session ended, sign in again.</p>
        ) : (
          <p className="lock-hint">Enter the studio password to continue.</p>
        )}
        <label className="lock-label" htmlFor="studio-password">
          Password
        </label>
        <input
          id="studio-password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="lock-input"
        />
        {error && <p className="lock-error">{error}</p>}
        {remaining !== null && remaining <= 3 && (
          <p className="lock-error">{remaining === 1 ? "1 try left" : `${remaining} tries left`}</p>
        )}
        <button type="submit" className="btn btn-primary lock-submit" disabled={checking || !password}>
          {checking ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
