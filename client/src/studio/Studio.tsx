import { useEffect, useRef, useState } from "react";
import { DEMO_CATALOG, type Catalog, type Piece, type PieceStatus } from "../lib/catalog.ts";
import { exportCatalog, importCatalog, loadCatalog, resetCatalog, saveCatalog } from "../lib/catalog-store.ts";
import ConfirmDialog from "./ConfirmDialog.tsx";
import LockScreen from "./LockScreen.tsx";
import PieceForm from "./PieceForm.tsx";
import PieceList from "./PieceList.tsx";
import { newId } from "./util.ts";

type View = { name: "list" } | { name: "edit"; pieceId: string | null };

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
    setView({ name: "edit", pieceId: null });
  }

  function handleEdit(id: string) {
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
    const nextPieces = current.pieces.map(p => {
      if (p.id !== id) return p;
      const nextStatus: PieceStatus = p.status === "available" ? "sold" : "available";
      return { ...p, status: nextStatus };
    });
    await persist({ ...current, pieces: nextPieces });
  }

  async function handleSavePiece(piece: Piece) {
    const exists = current.pieces.some(p => p.id === piece.id);
    const nextPieces = exists
      ? current.pieces.map(p => (p.id === piece.id ? piece : p))
      : [...current.pieces, piece];
    await persist({ ...current, pieces: nextPieces });
    setView({ name: "list" });
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
        This saves only to this browser — it does not put anything on the live shop. Use Export to hand
        your changes to whoever updates the site.
      </p>

      {importError && <p className="import-error">{importError}</p>}

      {view.name === "list" && (
        <PieceList
          pieces={current.pieces}
          onAddNew={handleAddNew}
          onEdit={handleEdit}
          onDelete={id => void handleDelete(id)}
          onMove={(id, dir) => void handleMove(id, dir)}
          onToggleSold={id => void handleToggleSold(id)}
        />
      )}

      {view.name === "edit" && editingPiece && (
        <PieceForm piece={editingPiece} onSave={p => void handleSavePiece(p)} onCancel={() => setView({ name: "list" })} />
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
