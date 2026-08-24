import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  CATEGORY_LABELS,
  formatSize,
  PRICE_BANDS,
  STATUS_LABELS,
  UNIT_LABELS,
  type MediaRef,
  type Piece,
  type PieceCategory,
  type PieceStatus,
  type Size,
  type SizeUnit,
} from "../lib/catalog.ts";
import { deleteMedia, putMedia, resolveMedia } from "../lib/catalog-store.ts";
import ScaleFigure from "../components/ScaleFigure.tsx";
import { compressImage, formatBytes } from "./compress.ts";
import ConfirmDialog from "./ConfirmDialog.tsx";
import { newId, slugify } from "./util.ts";

type Props = {
  piece: Piece;
  onSave: (piece: Piece, quantity: number, notes: string) => void;
  onCancel: () => void;
  /** Fires as soon as a spreadsheet URL is known, even before the first save. */
  onSheetUrl?: (url: string) => void;
};

// A video this big is unlikely to fit in IndexedDB alongside everything
// else — warn rather than silently fail later.
const VIDEO_WARN_BYTES = 50 * 1024 * 1024;

function parseNum(s: string): number | undefined {
  if (s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** No numbers entered means no size object at all, not an empty one. */
function computeSize(unit: SizeUnit, h: string, l: string, d: string, hasDepth: boolean): Size | undefined {
  const height = parseNum(h);
  const length = parseNum(l);
  const depth = hasDepth ? parseNum(d) : undefined;
  if (height == null && length == null && depth == null) return undefined;
  const size: Size = { unit };
  if (height != null) size.height = height;
  if (length != null) size.length = length;
  if (depth != null) size.depth = depth;
  return size;
}

// One form for both "add a piece" and "edit a piece" — the caller decides
// which by what it passes in as `piece`.
export default function PieceForm({ piece, onSave, onCancel, onSheetUrl }: Props) {
  const [draft, setDraft] = useState<Piece>(piece);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [mediaPendingDelete, setMediaPendingDelete] = useState<MediaRef | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [uploadNotes, setUploadNotes] = useState<string[]>([]);

  // Size fields live as strings so a typed "1." or "" doesn't get eaten by a
  // number cast on every keystroke — they're only parsed on the way out.
  const [unit, setUnit] = useState<SizeUnit>(piece.size?.unit ?? "cm");
  const [heightStr, setHeightStr] = useState(piece.size?.height != null ? String(piece.size.height) : "");
  const [lengthStr, setLengthStr] = useState(piece.size?.length != null ? String(piece.size.length) : "");
  const [depthStr, setDepthStr] = useState(piece.size?.depth != null ? String(piece.size.depth) : "");
  const [hasDepth, setHasDepth] = useState(piece.size?.depth != null);

  // Quantity and sheet notes don't live on Piece — they live in the sheet
  // itself. Default to "1 and blank" for a new piece; for an existing one
  // we fetch the real values below so a save here can't stomp a count Hajar
  // just typed directly into the sheet.
  const [quantityStr, setQuantityStr] = useState("1");
  const [notes, setNotes] = useState("");
  const [sheetPrefillFailed, setSheetPrefillFailed] = useState(false);

  useEffect(() => {
    if (!piece.slug) return; // new piece — nothing in the sheet to fetch yet
    let cancelled = false;
    fetch(`/api/studio-sheet?slug=${encodeURIComponent(piece.slug)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: { quantity?: number | null; notes?: string; url?: string }) => {
        if (cancelled) return;
        if (typeof data.quantity === "number") setQuantityStr(String(data.quantity));
        if (typeof data.notes === "string") setNotes(data.notes);
        if (typeof data.url === "string") onSheetUrl?.(data.url);
      })
      .catch(() => {
        if (!cancelled) setSheetPrefillFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece.slug]);

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

  function applySize(nextUnit: SizeUnit, nextH: string, nextL: string, nextD: string, nextHasDepth: boolean) {
    setDraft(d => ({ ...d, size: computeSize(nextUnit, nextH, nextL, nextD, nextHasDepth) }));
  }

  function onUnitChange(u: SizeUnit) {
    setUnit(u);
    applySize(u, heightStr, lengthStr, depthStr, hasDepth);
  }
  function onHeightChange(v: string) {
    setHeightStr(v);
    applySize(unit, v, lengthStr, depthStr, hasDepth);
  }
  function onLengthChange(v: string) {
    setLengthStr(v);
    applySize(unit, heightStr, v, depthStr, hasDepth);
  }
  function onDepthChange(v: string) {
    setDepthStr(v);
    applySize(unit, heightStr, lengthStr, v, hasDepth);
  }
  function onHasDepthToggle(next: boolean) {
    setHasDepth(next);
    // Turning the toggle off clears the value too, not just the input — a
    // stale depth would otherwise still print in the size and draw in the
    // scale preview.
    if (!next) setDepthStr("");
    applySize(unit, heightStr, lengthStr, next ? depthStr : "", next);
  }

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setMediaError(null);
    const notes: string[] = [];
    const added: MediaRef[] = [];

    for (const file of Array.from(files)) {
      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");
      if (!isVideo && !isImage) continue;

      let blob: Blob = file;
      if (isImage) {
        const result = await compressImage(file);
        blob = result.blob;
        notes.push(`${file.name}: ${formatBytes(result.originalBytes)} → ${formatBytes(result.finalBytes)}`);
      } else if (file.size > VIDEO_WARN_BYTES) {
        notes.push(`${file.name}: ${formatBytes(file.size)} — that's a big video, it may not save in this browser.`);
      }

      const blobKey = newId("blob");
      try {
        await putMedia(blobKey, blob);
      } catch {
        // Storage quota hit (or something else wrong with IndexedDB). Say so
        // plainly and skip this file rather than adding a reference to a
        // blob that never actually landed — that would resolve to a blank
        // tile with no clue why.
        setMediaError(
          `Couldn't save ${file.name} — this browser's storage is full. Delete a photo or two, then try again.`,
        );
        continue;
      }
      added.push({ id: newId("m"), kind: isVideo ? "video" : "image", blobKey });
    }

    if (notes.length) setUploadNotes(notes);
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

  function updateCaption(id: string, caption: string) {
    setDraft(d => ({ ...d, media: d.media.map(m => (m.id === id ? { ...m, caption } : m)) }));
  }

  // Reordering, not drag-and-drop — dragging a tile inside a page that's
  // already scrolling fights the scroll on a phone.
  function moveMedia(id: string, direction: "up" | "down") {
    setDraft(d => {
      const idx = d.media.findIndex(m => m.id === id);
      const swapWith = direction === "up" ? idx - 1 : idx + 1;
      if (idx === -1 || swapWith < 0 || swapWith >= d.media.length) return d;
      const media = [...d.media];
      [media[idx], media[swapWith]] = [media[swapWith], media[idx]];
      return { ...d, media };
    });
  }

  function handleSubmit() {
    const title = draft.title.trim() || "Untitled piece";
    const slug = draft.slug || slugify(title);
    // An empty or unparseable field means "she didn't mean to change this",
    // not "zero" — 0 is the one value with a public consequence (sold out),
    // so it should only ever come from her actually typing it.
    const parsedQuantity = parseInt(quantityStr, 10);
    const quantity = Number.isFinite(parsedQuantity) ? Math.max(0, parsedQuantity) : 1;
    onSave({ ...draft, title, slug }, quantity, notes);
  }

  return (
    <div className="piece-form-wrap">
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
              inputMode="decimal"
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
              inputMode="decimal"
              value={draft.year ?? ""}
              onChange={e => update("year", e.target.value === "" ? undefined : Number(e.target.value))}
              placeholder="2026"
            />
          </label>
        </div>
        <p className="field-hint">Typical range: {priceHint}</p>

        <label className="field">
          <span>How many do you have?</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={quantityStr}
            onChange={e => setQuantityStr(e.target.value)}
          />
        </label>
        <p className="field-hint">
          This is the number in your inventory sheet. 0 means the website shows this piece as sold out.
        </p>
        {sheetPrefillFailed && (
          <p className="field-hint field-hint-warn">
            Couldn't check your inventory sheet — saving now will overwrite the count and any notes there
            with what's shown here.
          </p>
        )}

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

        <label className="field">
          <span>Materials</span>
          <input
            type="text"
            value={draft.materials ?? ""}
            onChange={e => update("materials", e.target.value)}
            placeholder="e.g. Plaster, gold leaf"
          />
        </label>

        <section className="size-section">
          <h2>Size</h2>

          <label className="field">
            <span>Units</span>
            <select value={unit} onChange={e => onUnitChange(e.target.value as SizeUnit)}>
              {Object.entries(UNIT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <div className="field-row">
            <label className="field">
              <span>Height</span>
              <input type="text" inputMode="decimal" value={heightStr} onChange={e => onHeightChange(e.target.value)} placeholder="0" />
            </label>
            <label className="field">
              <span>Length (width)</span>
              <input type="text" inputMode="decimal" value={lengthStr} onChange={e => onLengthChange(e.target.value)} placeholder="0" />
            </label>
          </div>

          <label className="toggle-field">
            <input type="checkbox" checked={hasDepth} onChange={e => onHasDepthToggle(e.target.checked)} />
            <span>This piece is 3D (has depth)</span>
          </label>

          {hasDepth && (
            <label className="field">
              <span>Depth</span>
              <input type="text" inputMode="decimal" value={depthStr} onChange={e => onDepthChange(e.target.value)} placeholder="0" />
            </label>
          )}

          <ScaleFigure size={draft.size} formatted={formatSize(draft)} />

          <label className="field">
            <span>Or describe the size in words instead (only if it truly has no fixed measurements)</span>
            <input
              type="text"
              value={draft.dimensions ?? ""}
              onChange={e => update("dimensions", e.target.value)}
              placeholder='e.g. "Sized to the wall"'
            />
          </label>
        </section>

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

          {mediaError && <p className="media-error">{mediaError}</p>}

          {uploadNotes.length > 0 && (
            <ul className="upload-notes">
              {uploadNotes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          )}

          {draft.media.length > 0 && (
            <div className="media-grid">
              {draft.media.map((m, i) => {
                const isCover = draft.coverId === m.id || (!draft.coverId && draft.media.find(x => x.kind === "image")?.id === m.id);
                return (
                  <div key={m.id} className={`media-tile${isCover ? " media-tile-cover" : ""}`}>
                    {m.kind === "image" ? (
                      <img src={previews[m.id]} alt={m.caption || draft.title} />
                    ) : (
                      <video src={previews[m.id]} muted />
                    )}
                    <div className="media-tile-body">
                      <input
                        type="text"
                        value={m.caption ?? ""}
                        onChange={e => updateCaption(m.id, e.target.value)}
                        placeholder="What's in this photo?"
                      />
                      <div className="media-tile-move">
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={i === 0}
                          onClick={() => moveMedia(m.id, "up")}
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={i === draft.media.length - 1}
                          onClick={() => moveMedia(m.id, "down")}
                        >
                          Move down
                        </button>
                      </div>
                      <div className="media-tile-actions">
                        {m.kind === "image" && (
                          <button
                            type="button"
                            className="btn btn-small btn-block"
                            disabled={isCover}
                            onClick={() => update("coverId", m.id)}
                          >
                            {isCover ? "Cover photo" : "Make this the cover photo"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-small btn-danger btn-block"
                          onClick={() => setMediaPendingDelete(m)}
                        >
                          Delete this file
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="form-sticky-bar">
        <div className="form-actions">
          <button type="button" className="btn btn-plain" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSubmit}>
            Save piece
          </button>
        </div>
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
