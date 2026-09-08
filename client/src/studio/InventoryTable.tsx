import { useEffect, useState } from "react";
import ConfirmDialog from "./ConfirmDialog.tsx";

type InventoryRow = {
  slug: string;
  title: string;
  price: number | null;
  quantity: number;
  notes: string;
  updatedAt: string;
};

type RowDraft = {
  priceStr: string;
  quantityStr: string;
  notes: string;
  status: "idle" | "saving" | "saved" | "failed";
  message: string | null;
};

// 401 is the one error where the server's message isn't enough on its own:
// "Not signed in." is true but doesn't tell her what to do about it. The
// screen behind this drops to the lock screen at the same time.
function errorFrom(res: Response, serverMessage: string | undefined, fallback: string): string {
  if (res.status === 401) return "Your session ended, sign in again.";
  return serverMessage || fallback;
}

function draftFromRow(row: InventoryRow): RowDraft {
  return {
    priceStr: row.price == null ? "" : String(row.price),
    quantityStr: String(row.quantity),
    notes: row.notes,
    status: "idle",
    message: null,
  };
}

// A dirty or failed draft holds work she hasn't confirmed is saved yet — a
// refresh must never quietly throw that away just because another device
// (or her own reload) brought back a different row underneath it.
function isDirty(draft: RowDraft, row: InventoryRow): boolean {
  if (draft.status === "failed") return true;
  const priceMatches = (row.price == null ? "" : String(row.price)) === draft.priceStr;
  return !priceMatches || String(row.quantity) !== draft.quantityStr || row.notes !== draft.notes;
}

type Props = {
  /** Changes when she signs back in, which is the cue to load again. */
  session?: number;
  /** Called on any 401 so the whole studio locks, not just this tab. */
  onSessionEnded?: () => void;
};

export default function InventoryTable({ session, onSessionEnded }: Props) {
  const [rows, setRows] = useState<InventoryRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<InventoryRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/studio-inventory");
      const data = (await res.json().catch(() => ({}))) as { rows?: InventoryRow[]; error?: string };
      if (!res.ok) {
        if (res.status === 401) onSessionEnded?.();
        setLoadError(errorFrom(res, data.error, "Couldn't load your inventory."));
        setLoading(false);
        return;
      }
      const nextRows = data.rows ?? [];
      setRows(nextRows);
      setDrafts(prev => {
        const next: Record<string, RowDraft> = {};
        for (const row of nextRows) {
          const existing = prev[row.slug];
          next[row.slug] = existing && isDirty(existing, row) ? existing : draftFromRow(row);
        }
        return next;
      });
    } catch {
      setLoadError("Couldn't load your inventory.");
    } finally {
      setLoading(false);
    }
  }

  // This tab stays mounted while the lock screen is up, so a fresh sign-in
  // reloads it. The dirty check in load() keeps any half-typed row.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function updateDraft(slug: string, patch: Partial<RowDraft>) {
    setDrafts(prev => ({ ...prev, [slug]: { ...prev[slug], ...patch } }));
  }

  // Compares the fields a save was fired with against the draft as it
  // stands now, so a slow response doesn't clobber keystrokes she made
  // while the request was in flight.
  function sameFields(a: RowDraft, b: RowDraft) {
    return a.priceStr === b.priceStr && a.quantityStr === b.quantityStr && a.notes === b.notes;
  }

  async function save(row: InventoryRow) {
    const draft = drafts[row.slug];
    if (!draft) return;
    // Tabbing through an untouched row (or blurring right back to what the
    // server already has) shouldn't fire a request — but a click on Save
    // still deserves an acknowledgement rather than doing nothing.
    if (!isDirty(draft, row)) {
      updateDraft(row.slug, { status: "saved", message: null });
      return;
    }
    updateDraft(row.slug, { status: "saving", message: null });

    const rawPrice = draft.priceStr.trim();
    // Blank means "leave it" everywhere else in the studio except a blank
    // price — 0 has a public consequence (sold out), so only her actually
    // typing 0 should produce it. Send the raw string through and let the
    // server refuse anything it can't parse, same as every other field.

    try {
      const res = await fetch("/api/studio-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: row.slug,
          title: row.title,
          price: rawPrice === "" ? null : rawPrice,
          quantity: draft.quantityStr,
          notes: draft.notes,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (res.status === 401) onSessionEnded?.();
        updateDraft(row.slug, { status: "failed", message: errorFrom(res, data.error, "Couldn't save. Try again.") });
        return;
      }

      // The server may have normalised what she typed ("$1,200" -> 1200) —
      // fetch the row back so the cell shows what's actually stored, not
      // just what she pasted in. But if she kept typing while this was in
      // flight, don't stomp that with the echo — leave the newer draft alone
      // and let its own blur save it.
      const check = await fetch(`/api/studio-inventory?slug=${encodeURIComponent(row.slug)}`);
      const checkData = (await check.json().catch(() => ({}))) as { row?: InventoryRow | null };
      if (check.ok && checkData.row) {
        const fresh = checkData.row;
        setRows(prev => (prev ? prev.map(r => (r.slug === fresh.slug ? fresh : r)) : prev));
        setDrafts(prev => {
          const current = prev[row.slug];
          if (!current || !sameFields(current, draft)) return prev;
          return { ...prev, [row.slug]: { ...draftFromRow(fresh), status: "saved" } };
        });
      } else {
        setDrafts(prev => {
          const current = prev[row.slug];
          if (!current || !sameFields(current, draft)) return prev;
          return { ...prev, [row.slug]: { ...current, status: "saved" } };
        });
      }
    } catch {
      updateDraft(row.slug, { status: "failed", message: "Couldn't reach your inventory. Try again." });
    }
  }

  async function confirmRemove() {
    if (!pendingRemove) return;
    const target = pendingRemove;
    setRemoveError(null);
    try {
      const res = await fetch(`/api/studio-inventory?slug=${encodeURIComponent(target.slug)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (res.status === 401) onSessionEnded?.();
        setPendingRemove(null);
        setRemoveError(errorFrom(res, data.error, "Couldn't remove that entry."));
        return;
      }
      setRows(prev => (prev ? prev.filter(r => r.slug !== target.slug) : prev));
      setDrafts(prev => {
        const next = { ...prev };
        delete next[target.slug];
        return next;
      });
      setPendingRemove(null);
    } catch {
      setPendingRemove(null);
      setRemoveError("Couldn't reach your inventory. Try again.");
    }
  }

  if (loading && rows === null) {
    return <p className="empty-note">Loading your stock…</p>;
  }

  return (
    <div className="inventory-view">
      <div className="inventory-header">
        <p className="lede">Price and how many you have. This is what the website charges against.</p>
        <button type="button" className="btn btn-plain" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      {loadError && <p className="import-error">{loadError}</p>}
      {removeError && <p className="import-error">{removeError}</p>}

      {rows && rows.length === 0 && !loadError && (
        <p className="empty-note">
          Nothing here yet. A piece shows up once you post it.
        </p>
      )}

      {rows && rows.length > 0 && (
        <table className="inventory-table">
          <thead>
            <tr>
              <th>Piece</th>
              <th>Price</th>
              <th>Quantity (0 = sold out)</th>
              <th>Notes — only you see these</th>
              <th>Save</th>
              <th>Remove</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const draft = drafts[row.slug] ?? draftFromRow(row);
              return (
                <tr key={row.slug} className="inventory-row">
                  <td className="inventory-title-cell">
                    <span className="inventory-title">{row.title}</span>
                  </td>
                  <td>
                    <label className="inv-cell">
                      <span className="inv-cell-label">Price</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draft.priceStr}
                        placeholder="Blank = not for sale"
                        onChange={e => updateDraft(row.slug, { priceStr: e.target.value, status: "idle", message: null })}
                        onBlur={() => void save(row)}
                      />
                    </label>
                  </td>
                  <td>
                    <label className="inv-cell">
                      <span className="inv-cell-label">Quantity</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={draft.quantityStr}
                        aria-describedby={`inv-qty-hint-${row.slug}`}
                        onChange={e => updateDraft(row.slug, { quantityStr: e.target.value, status: "idle", message: null })}
                        onBlur={() => void save(row)}
                      />
                    </label>
                    <span className="inv-cell-hint" id={`inv-qty-hint-${row.slug}`}>
                      0 = sold out on the website
                    </span>
                  </td>
                  <td>
                    <label className="inv-cell">
                      <span className="inv-cell-label">Notes (for you only — never shown on the site)</span>
                      <input
                        type="text"
                        value={draft.notes}
                        placeholder="For you only — never shown on the site"
                        onChange={e => updateDraft(row.slug, { notes: e.target.value, status: "idle", message: null })}
                        onBlur={() => void save(row)}
                      />
                    </label>
                  </td>
                  <td className="inventory-save-cell">
                    <button
                      type="button"
                      className={`btn btn-small btn-block${draft.status === "failed" ? " btn-danger" : ""}`}
                      onClick={() => void save(row)}
                      disabled={draft.status === "saving"}
                    >
                      {draft.status === "saving" && "Saving…"}
                      {draft.status === "saved" && "Saved"}
                      {draft.status === "failed" && "Retry save"}
                      {draft.status === "idle" && "Save"}
                    </button>
                    {draft.status === "failed" && draft.message && (
                      <p className="inv-row-error">{draft.message}</p>
                    )}
                  </td>
                  <td className="inventory-remove-cell">
                    <button
                      type="button"
                      className="btn btn-small btn-danger btn-block"
                      onClick={() => {
                        setRemoveError(null);
                        setPendingRemove(row);
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {pendingRemove && (
        <ConfirmDialog
          title={`Remove "${pendingRemove.title}" from your inventory?`}
          body="This only takes it out of your stock list — price and quantity stop showing on the site, so it falls back to the enquiry form. The piece itself, its photos, and its description stay exactly as they are."
          confirmLabel="Remove from inventory"
          onConfirm={() => void confirmRemove()}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  );
}
