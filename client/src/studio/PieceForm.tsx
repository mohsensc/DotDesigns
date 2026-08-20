import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  CATEGORY_LABELS,
  PRICE_BANDS,
  STATUS_LABELS,
  type MediaRef,
  type Piece,
  type PieceCategory,
  type PieceStatus,
} from "../lib/catalog.ts";
import { deleteMedia, putMedia, resolveMedia } from "../lib/catalog-store.ts";
import ConfirmDialog from "./ConfirmDialog.tsx";
import { newId, slugify } from "./util.ts";

type Props = {
  piece: Piece;
  onSave: (piece: Piece) => void;
  onCancel: () => void;
};

// One form for both "add a piece" and "edit a piece" — the caller decides
// which by what it passes in as `piece`.
export default function PieceForm({ piece, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<Piece>(piece);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [mediaPendingDelete, setMediaPendingDelete] = useState<MediaRef | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        draft.media.map(async m => [m.id, await resolveMedia(m)] as const),
      );
      if (cancelled) return;
      setPreviews(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [draft.media]);

  const priceHint = useMemo(
    () => PRICE_BANDS.map(b => `${b.label} — ${b.note}`).join(" · "),
    [],
  );

  function update<K extends keyof Piece>(key: K, value: Piece[K]) {
    setDraft(d => ({ ...d, [key]: value }));
  }

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const added: MediaRef[] = [];
    for (const file of Array.from(files)) {
      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");
      if (!isVideo && !isImage) continue;
      const blobKey = newId("blob");
      await putMedia(blobKey, file);
      added.push({ id: newId("m"), kind: isVideo ? "video" : "image", blobKey, alt: file.name });
    }
    if (added.length === 0) return;
    setDraft(d => ({ ...d, media: [...d.media, ...added] }));
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    void addFiles(e.dataTransfer.files);
  }

  async function confirmDeleteMedia() {
    if (!mediaPendingDelete) return;
    const target = mediaPendingDelete;
    if (target.blobKey) await deleteMedia(target.blobKey);
    setDraft(d => ({
      ...d,
      media: d.media.filter(m => m.id !== target.id),
      coverId: d.coverId === target.id ? undefined : d.coverId,
    }));
    setMediaPendingDelete(null);
  }

  function handleSubmit() {
    const title = draft.title.trim() || "Untitled piece";
    const slug = draft.slug || slugify(title);
    onSave({ ...draft, title, slug });
  }

  return (
    <div className="piece-form">
      <h1>{piece.title ? "Edit piece" : "Add a piece"}</h1>

      <label className="field">
        <span>Title</span>
        <input
          type="text"
          value={draft.title}
          onChange={e => update("title", e.target.value)}
          placeholder="e.g. Studio Vessel No. 5"
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span>Price (CAD)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={draft.price ?? ""}
            onChange={e => update("price", e.target.value === "" ? null : Number(e.target.value))}
            placeholder="Leave blank for price on request"
          />
        </label>
        <label className="field">
          <span>Year</span>
          <input
            type="number"
            value={draft.year ?? ""}
            onChange={e => update("year", e.target.value === "" ? undefined : Number(e.target.value))}
            placeholder="2026"
          />
        </label>
      </div>
      <p className="field-hint">Typical range: {priceHint}</p>

      <div className="field-row">
        <label className="field">
          <span>Category</span>
          <select
            value={draft.category}
            onChange={e => update("category", e.target.value as PieceCategory)}
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select value={draft.status} onChange={e => update("status", e.target.value as PieceStatus)}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>Short blurb (one or two lines, shown on the grid)</span>
        <textarea rows={2} value={draft.blurb} onChange={e => update("blurb", e.target.value)} />
      </label>

      <label className="field">
        <span>Full description</span>
        <textarea rows={5} value={draft.description} onChange={e => update("description", e.target.value)} />
      </label>

      <div className="field-row">
        <label className="field">
          <span>Dimensions</span>
          <input
            type="text"
            value={draft.dimensions ?? ""}
            onChange={e => update("dimensions", e.target.value)}
            placeholder='e.g. 48 × 36 in'
          />
        </label>
        <label className="field">
          <span>Materials</span>
          <input
            type="text"
            value={draft.materials ?? ""}
            onChange={e => update("materials", e.target.value)}
            placeholder="e.g. Plaster, gold leaf"
          />
        </label>
      </div>

      <section className="media-section">
        <h2>Photos and videos</h2>
        <div
          className={`drop-zone${dragOver ? " drop-zone-active" : ""}`}
          onDragOver={e => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <p>Drag photos or videos here, or</p>
          <label className="btn btn-primary file-btn">
            Choose files
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={e => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        {draft.media.length > 0 && (
          <div className="media-grid">
            {draft.media.map(m => {
              const isCover = draft.coverId === m.id || (!draft.coverId && draft.media.find(x => x.kind === "image")?.id === m.id);
              return (
                <div key={m.id} className={`media-tile${isCover ? " media-tile-cover" : ""}`}>
                  {m.kind === "image" ? (
                    <img src={previews[m.id]} alt={m.alt ?? draft.title} />
                  ) : (
                    <video src={previews[m.id]} muted />
                  )}
                  <div className="media-tile-actions">
                    {m.kind === "image" && (
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={isCover}
                        onClick={() => update("coverId", m.id)}
                      >
                        {isCover ? "Cover photo" : "Make cover photo"}
                      </button>
                    )}
                    <button type="button" className="btn btn-small btn-danger" onClick={() => setMediaPendingDelete(m)}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="form-actions">
        <button type="button" className="btn btn-plain" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={handleSubmit}>
          Save piece
        </button>
      </div>

      {mediaPendingDelete && (
        <ConfirmDialog
          title="Delete this file?"
          body="This removes it from the piece and deletes it from this browser. It can't be undone."
          confirmLabel="Delete file"
          onConfirm={() => void confirmDeleteMedia()}
          onCancel={() => setMediaPendingDelete(null)}
        />
      )}
    </div>
  );
}
