import { useState, type FormEvent } from "react";

type Props = {
  onUnlocked: () => void;
};

// Full-screen gate. The password itself never leaves this form — it's POSTed
// once and the server hands back a cookie, nothing else.
export default function LockScreen({ onUnlocked }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

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
        onUnlocked();
        return;
      }
      if (res.status === 500) {
        setError("This studio isn't set up yet. Ask whoever runs the site to finish setup.");
      } else {
        setError("That password isn't right. Try again.");
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={handleSubmit}>
        <h1>Dot Designs Studio</h1>
        <p className="lock-hint">Enter the studio password to continue.</p>
        <label className="lock-label" htmlFor="studio-password">
          Password
        </label>
        <input
          id="studio-password"
          type="password"
          autoFocus
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="lock-input"
        />
        {error && <p className="lock-error">{error}</p>}
        <button type="submit" className="btn btn-primary lock-submit" disabled={checking || !password}>
          {checking ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
