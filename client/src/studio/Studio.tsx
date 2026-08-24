import { useEffect, useRef, useState } from "react";
import { DEMO_CATALOG, type Catalog, type Piece, type PieceStatus } from "../lib/catalog.ts";
import { exportCatalog, importCatalog, loadCatalog, resetCatalog, saveCatalog } from "../lib/catalog-store.ts";
import ConfirmDialog from "./ConfirmDialog.tsx";
import LockScreen from "./LockScreen.tsx";
import PieceForm from "./PieceForm.tsx";
import PieceList from "./PieceList.tsx";
import { newId, slugify } from "./util.ts";

type View = { name: "list" } | { name: "edit"; pieceId: string | null };

type SheetSyncState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "ok" }
  | { status: "error"; message: string };

type SheetPayload = { piece: Piece; quantity: number; notes: string };

function blankPiece(nextOrder: number): Piece {
  return {
    id: newId("p"),
    slug: "",
    title: "",
    category: "sculpture",
    status: "draft",
    price: null,
    blurb: "",
    description: "",
    media: [],
    order: nextOrder,
    createdAt: new Date().toISOString(),
  };
}

export default function Studio() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [view, setView] = useState<View>({ name: "list" });
  const [confirmReset, setConfirmReset] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sheetSync, setSheetSync] = useState<SheetSyncState>({ status: "idle" });
  const [sheetRetry, setSheetRetry] = useState<SheetPayload | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/studio-auth")
      .then(res => res.json())
      .then((data: { unlocked?: boolean }) => setUnlocked(!!data.unlocked))
      .catch(() => setUnlocked(false));
  }, []);

  useEffect(() => {
    if (unlocked) loadCatalog().then(setCatalog);
  }, [unlocked]);

  if (unlocked === null || (unlocked && !catalog)) {
    return <div className="studio-loading">Loading…</div>;
  }

  if (!unlocked) {
    return <LockScreen onUnlocked={() => setUnlocked(true)} />;
  }

  const current = catalog!;

  async function persist(next: Catalog) {
    await saveCatalog(next);
    setCatalog(next);
  }

  function handleAddNew() {
    setSheetSync({ status: "idle" });
    setView({ name: "edit", pieceId: null });
  }

  function handleEdit(id: string) {
    setSheetSync({ status: "idle" });
    setView({ name: "edit", pieceId: id });
  }

  async function handleDelete(id: string) {
    const next: Catalog = { ...current, pieces: current.pieces.filter(p => p.id !== id) };
    await persist(next);
  }

  async function handleMove(id: string, direction: "up" | "down") {
    const sorted = [...current.pieces].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex(p => p.id === id);
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (idx === -1 || swapWith < 0 || swapWith >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swapWith];
    const nextPieces = current.pieces.map(p => {
      if (p.id === a.id) return { ...p, order: b.order };
      if (p.id === b.id) return { ...p, order: a.order };
      return p;
    });
    await persist({ ...current, pieces: nextPieces });
  }

  async function handleToggleSold(id: string) {
    const target = current.pieces.find(p => p.id === id);
    if (!target) return;
    const nextStatus: PieceStatus = target.status === "available" ? "sold" : "available";
    const saved = { ...target, status: nextStatus };
    const nextPieces = current.pieces.map(p => (p.id === id ? saved : p));
    await persist({ ...current, pieces: nextPieces });

    // The sheet's quantity is what the live site reads, and it wins over this
    // status once a piece has a row there. Flipping the toggle without writing
    // the quantity across would leave her looking at "Sold" in here while the
    // shop happily kept selling it. Sold means none left; back in stock means one.
    void syncToSheet({ piece: saved, quantity: nextStatus === "sold" ? 0 : 1, notes: "" });
  }

  async function handleDuplicate(id: string) {
    const original = current.pieces.find(p => p.id === id);
    if (!original) return;

    const title = `${original.title || "Untitled piece"} (copy)`;
    const taken = new Set(current.pieces.map(p => p.slug));
    let slug = slugify(title);
    for (let n = 2; taken.has(slug); n++) slug = `${slugify(title)}-${n}`;

    const copy: Piece = {
      ...original,
      id: newId("p"),
      slug,
      title,
      status: "draft",
      // Photos deliberately not copied: two pieces must never share a
      // blobKey, since deleting one would silently blank the other.
      media: [],
      coverId: undefined,
      createdAt: new Date().toISOString(),
    };

    // Re-sequence every piece's order so the copy lands right after the
    // original, regardless of whether existing order values are contiguous.
    const sorted = [...current.pieces].sort((a, b) => a.order - b.order);
    const insertAt = sorted.findIndex(p => p.id === id) + 1;
    sorted.splice(insertAt, 0, copy);
    const nextPieces = sorted.map((p, i) => ({ ...p, order: i }));
    await persist({ ...current, pieces: nextPieces });
  }

  async function handleSavePiece(piece: Piece, quantity: number, notes: string) {
    const exists = current.pieces.some(p => p.id === piece.id);
    // The form derives the slug from the title, which two pieces can easily
    // share ("Untitled piece" twice is enough). The slug is the shop's URL, so a
    // duplicate would leave the second piece unreachable. Suffix until it's free.
    const taken = new Set(current.pieces.filter(p => p.id !== piece.id).map(p => p.slug));
    let slug = piece.slug;
    for (let n = 2; taken.has(slug); n++) slug = `${piece.slug}-${n}`;

    const saved = { ...piece, slug };
    const nextPieces = exists
      ? current.pieces.map(p => (p.id === piece.id ? saved : p))
      : [...current.pieces, saved];
    // Local save first, always — the sheet is a bonus on top of it, not a
    // gate. Whatever happens next, her work is already kept.
    await persist({ ...current, pieces: nextPieces });
    setView({ name: "list" });
    void syncToSheet({ piece: saved, quantity, notes });
  }

  async function syncToSheet(payload: SheetPayload) {
    setSheetSync({ status: "sending" });
    setSheetRetry(null);
    try {
      const res = await fetch("/api/studio-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: payload.piece.slug,
          title: payload.piece.title,
          price: payload.piece.price,
          quantity: payload.quantity,
          notes: payload.notes,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok) {
        setSheetSync({ status: "error", message: data.error || "Couldn't reach the inventory sheet." });
        setSheetRetry(payload);
        return;
      }
      if (data.url) setSheetUrl(data.url);
      setSheetSync({ status: "ok" });
    } catch {
      setSheetSync({ status: "error", message: "Couldn't reach the inventory sheet." });
      setSheetRetry(payload);
    }
  }

  function handleExport() {
    const json = exportCatalog(current);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dot-catalog-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function handleImportFile(file: File) {
    setImportError(null);
    try {
      const text = await file.text();
      const next = await importCatalog(text);
      setCatalog(next);
      setView({ name: "list" });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  }

  async function handleReset() {
    await resetCatalog();
    setCatalog(DEMO_CATALOG);
    setConfirmReset(false);
    setView({ name: "list" });
  }

  const editingPiece =
    view.name === "edit"
      ? view.pieceId
        ? current.pieces.find(p => p.id === view.pieceId) ?? null
        : blankPiece(current.pieces.length ? Math.max(...current.pieces.map(p => p.order)) + 1 : 1)
      : null;

  return (
    <div className="studio">
      <header className="studio-header">
        <div className="studio-header-title">Dot Designs Studio</div>
        <div className="studio-header-actions">
          <button type="button" className="btn btn-plain" onClick={handleExport}>
            Export catalog
          </button>
          <label className="btn btn-plain file-btn">
            Import catalog
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
                e.target.value = "";
              }}
            />
          </label>
          <button type="button" className="btn btn-plain" onClick={() => setConfirmReset(true)}>
            Reset to demo pieces
          </button>
        </div>
      </header>

      <p className="studio-honesty-banner">
        Photos and descriptions save only to this browser — use Export to hand those to whoever updates
        the site. Price and how many you have go to your inventory sheet when you save a piece, so stock
        stays accurate there.
      </p>

      {sheetSync.status !== "idle" && (
        <p className={`sheet-sync-line sheet-sync-${sheetSync.status}`}>
          {sheetSync.status === "sending" && "Sending to your inventory sheet…"}
          {sheetSync.status === "ok" && "Added to your inventory sheet."}
          {sheetSync.status === "error" && (
            <>
              {sheetSync.message}{" "}
              <button type="button" className="btn btn-small" onClick={() => sheetRetry && void syncToSheet(sheetRetry)}>
                Retry
              </button>
            </>
          )}
        </p>
      )}

      {sheetUrl && (
        <a className="sheet-link" href={sheetUrl} target="_blank" rel="noreferrer">
          Open your inventory sheet
        </a>
      )}

      {importError && <p className="import-error">{importError}</p>}

      {view.name === "list" && (
        <PieceList
          pieces={current.pieces}
          onAddNew={handleAddNew}
          onEdit={handleEdit}
          onDelete={id => void handleDelete(id)}
          onMove={(id, dir) => void handleMove(id, dir)}
          onToggleSold={id => void handleToggleSold(id)}
          onDuplicate={id => void handleDuplicate(id)}
        />
      )}

      {view.name === "edit" && editingPiece && (
        <PieceForm
          piece={editingPiece}
          onSave={(p, quantity, notes) => void handleSavePiece(p, quantity, notes)}
          onCancel={() => setView({ name: "list" })}
          onSheetUrl={setSheetUrl}
        />
      )}

      {confirmReset && (
        <ConfirmDialog
          title="Reset to the demo pieces?"
          body="This replaces everything in this browser with the six starting demo pieces. Your uploaded photos and videos stay in storage but nothing will point at them anymore. Export first if you want to keep this catalog."
          confirmLabel="Reset catalog"
          onConfirm={() => void handleReset()}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
