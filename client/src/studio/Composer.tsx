import { useEffect, useRef, useState } from "react";
import {
  CATEGORY_LABELS,
  formatSize,
  STATUS_LABELS,
  UNIT_LABELS,
  type Catalog,
  type MediaRef,
  type Piece,
  type PieceCategory,
  type PieceStatus,
  type Size,
  type SizeUnit,
} from "../lib/catalog.ts";
import ScaleFigure from "../components/ScaleFigure.tsx";
import { formatBytes, isHeic, VIDEO_WARN_BYTES } from "./compress.ts";
import { publishPiece, PublishCancelled, type MediaItem, type PublishPhase } from "./publish.ts";
import ConfirmDialog from "./ConfirmDialog.tsx";
import ScreenHeader from "./ScreenHeader.tsx";
import { CatalogConflictError, loadInventoryRow, resolveMedia, StudioAuthError } from "./seam.ts";
import { newId, slugify } from "./util.ts";

type Props = {
  mode: "new" | "edit";
  piece: Piece;
  getExpectedUpdatedAt: () => string;
  onPosted: (catalog: Catalog, pieceId: string) => void;
  onCancel: () => void;
  onSessionEnded: () => void;
};

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

/** "$1,200" and "1200" both mean 1200. Blank means price on request. */
function parsePrice(s: string): number | null {
  const cleaned = s.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function itemsFrom(piece: Piece): MediaItem[] {
  return piece.media.map(m => ({ id: m.id, kind: m.kind, caption: m.caption ?? "", ref: m }));
}

/** The tool says "photos and videos" everywhere, so the messages should too. */
function nounFor(kind: MediaItem["kind"]): string {
  return kind === "video" ? "video" : "photo";
}

type FileNote = { id: string; text: string };

/** A photo she took out, kept long enough to put back. */
type RemovedItem = { item: MediaItem; index: number; wasCover: boolean };

// One row per item down the page instead of a horizontal scroller: on a phone
// nothing can be moved out of sight, and Up/Down match what she sees.

// Two screens, in Instagram's order: pick the photos, then write about them.
// Edit drops straight into the second one — most edits are a price or a typo.
export default function Composer({ mode, piece, getExpectedUpdatedAt, onPosted, onCancel, onSessionEnded }: Props) {
  const [step, setStep] = useState<"pick" | "details">(mode === "new" ? "pick" : "details");
  const [items, setItems] = useState<MediaItem[]>(() => itemsFrom(piece));
  const [coverItemId, setCoverItemId] = useState<string | undefined>(piece.coverId);
  const [removed, setRemoved] = useState<MediaRef[]>([]);
  const [fileNotes, setFileNotes] = useState<FileNote[]>([]);
  // A running tally, not fileNotes.length — dismissing a note shouldn't change it.
  const [skippedCount, setSkippedCount] = useState(0);
  const [lastRemoved, setLastRemoved] = useState<RemovedItem | null>(null);

  const [title, setTitle] = useState(piece.title);
  const [priceStr, setPriceStr] = useState(piece.price == null ? "" : String(piece.price));
  const [yearStr, setYearStr] = useState(piece.year == null ? "" : String(piece.year));
  const [quantityStr, setQuantityStr] = useState("1");
  const [notes, setNotes] = useState("");
  const [inventoryPrefillFailed, setInventoryPrefillFailed] = useState(false);
  const [category, setCategory] = useState<PieceCategory>(piece.category);
  const [status, setStatus] = useState<PieceStatus>(piece.status);
  const [blurb, setBlurb] = useState(piece.blurb);
  const [description, setDescription] = useState(piece.description);
  const [materials, setMaterials] = useState(piece.materials ?? "");
  const [dimensions, setDimensions] = useState(piece.dimensions ?? "");

  // Size fields stay strings so a half-typed "1." doesn't get eaten by a
  // number cast on every keystroke.
  const [unit, setUnit] = useState<SizeUnit>(piece.size?.unit ?? "cm");
  const [heightStr, setHeightStr] = useState(piece.size?.height != null ? String(piece.size.height) : "");
  const [lengthStr, setLengthStr] = useState(piece.size?.length != null ? String(piece.size.length) : "");
  const [depthStr, setDepthStr] = useState(piece.size?.depth != null ? String(piece.size.depth) : "");
  const [hasDepth, setHasDepth] = useState(piece.size?.depth != null);

  const [phase, setPhase] = useState<PublishPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Everything she can change, in one shape. useRef keeps the first render's
  // copy as the baseline; anything different means she'd lose work by leaving.
  const form = {
    media: items.map(i => `${i.id}:${i.caption}`),
    coverItemId,
    removedCount: removed.length,
    title,
    priceStr,
    yearStr,
    quantityStr,
    notes,
    category,
    status,
    blurb,
    description,
    materials,
    dimensions,
    unit,
    heightStr,
    lengthStr,
    depthStr,
    hasDepth,
  };
  const baselineRef = useRef(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(baselineRef.current);

  const objectUrls = useRef<string[]>([]);
  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!piece.slug) return; // nothing in stock for a piece that isn't posted yet
    let cancelled = false;
    loadInventoryRow(piece.slug)
      .then(row => {
        if (cancelled || !row) return;
        setQuantityStr(String(row.quantity));
        setNotes(row.notes);
        // The prefill isn't her editing, so it moves the baseline with it.
        baselineRef.current = { ...baselineRef.current, quantityStr: String(row.quantity), notes: row.notes };
      })
      .catch(() => {
        if (!cancelled) setInventoryPrefillFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [piece.slug]);

  const size = computeSize(unit, heightStr, lengthStr, depthStr, hasDepth);
  const previewPiece: Piece = { ...piece, title, size, dimensions: dimensions || undefined };
  const cover = coverItemId ?? items.find(i => i.kind === "image")?.id ?? items[0]?.id;
  const busy = phase !== null;

  function srcOf(item: MediaItem): string {
    return item.previewUrl ?? (item.ref ? resolveMedia(item.ref) : "");
  }

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const nextNotes: FileNote[] = [];
    const added: MediaItem[] = [];
    let skipped = 0;
    const note = (text: string) => nextNotes.push({ id: newId("note"), text });

    for (const file of Array.from(files)) {
      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");
      if (!isVideo && !isImage) {
        note(`${file.name} isn't a photo or a video, so it wasn't added.`);
        skipped++;
        continue;
      }

      if (isImage && isHeic(file)) {
        note(
          `${file.name} is a HEIC photo, which the website can't show. On your iPhone open Settings > Camera > Formats and choose "Most Compatible", then take or re-save the photo and add it again.`,
        );
        skipped++;
        continue;
      }
      if (isVideo && file.size > VIDEO_WARN_BYTES) {
        note(`${file.name} is ${formatBytes(file.size)} — a video that big takes a while to upload.`);
      }

      const url = URL.createObjectURL(file);
      objectUrls.current.push(url);
      added.push({
        id: newId("m"),
        kind: isVideo ? "video" : "image",
        caption: "",
        file,
        previewUrl: url,
      });
    }

    // Append. A clean second pick used to wipe the warning from the first one.
    if (nextNotes.length) setFileNotes(prev => [...prev, ...nextNotes]);
    if (skipped) setSkippedCount(c => c + skipped);
    if (added.length) setItems(prev => [...prev, ...added]);
  }

  function moveItem(id: string, direction: -1 | 1) {
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === id);
      const swap = idx + direction;
      if (idx === -1 || swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  function removeItem(id: string) {
    const index = items.findIndex(i => i.id === id);
    const target = items[index];
    if (!target) return;
    // Only a photo that's already on the server needs deleting later.
    if (target.ref) setRemoved(r => [...r, target.ref!]);
    setItems(prev => prev.filter(i => i.id !== id));
    const wasCover = coverItemId === id;
    if (wasCover) setCoverItemId(undefined);
    setLastRemoved({ item: target, index, wasCover });
  }

  /** Put back the item, its place in the order, and the cover if it was one. */
  function undoRemove() {
    const undo = lastRemoved;
    if (!undo) return;
    setItems(prev => {
      const next = [...prev];
      next.splice(Math.min(undo.index, next.length), 0, undo.item);
      return next;
    });
    if (undo.item.ref) setRemoved(r => r.filter(m => m !== undo.item.ref));
    if (undo.wasCover) setCoverItemId(undo.item.id);
    setLastRemoved(null);
  }

  function setCaption(id: string, caption: string) {
    setItems(prev => prev.map(i => (i.id === id ? { ...i, caption } : i)));
  }

  async function share() {
    if (busy) return; // one publish at a time — two would race on the same piece
    setError(null);
    setCancelling(false);
    const controller = new AbortController();
    abortRef.current = controller;
    const finalTitle = title.trim() || "Untitled piece";
    // Sold means none left. Letting her pick Sold and leave "1" here would say
    // sold in the studio while the shop kept selling it.
    const parsedQuantity = parseInt(quantityStr, 10);
    const quantity =
      status === "sold" ? 0 : Number.isFinite(parsedQuantity) ? Math.max(0, parsedQuantity) : 1;

    const draft: Piece = {
      ...piece,
      title: finalTitle,
      slug: piece.slug || slugify(finalTitle),
      price: parsePrice(priceStr),
      year: parseNum(yearStr),
      category,
      status,
      blurb: blurb.trim(),
      description: description.trim(),
      materials: materials.trim() || undefined,
      dimensions: dimensions.trim() || undefined,
      size,
    };

    try {
      const catalog = await publishPiece({
        piece: draft,
        items,
        coverItemId: cover,
        quantity,
        notes,
        removed,
        getExpectedUpdatedAt,
        onUploaded: (itemId, ref) =>
          setItems(prev => prev.map(i => (i.id === itemId ? { ...i, ref, file: undefined } : i))),
        onPhase: setPhase,
        signal: controller.signal,
      });
      onPosted(catalog, draft.id);
    } catch (err) {
      setPhase(null);
      setCancelling(false);
      abortRef.current = null;
      // She stopped it herself. Straight back to the form, nothing to explain.
      if (err instanceof PublishCancelled) return;
      if (err instanceof StudioAuthError) {
        setError("Your session ended. Sign in again, then tap Retry — nothing here is lost.");
        onSessionEnded();
        return;
      }
      if (err instanceof CatalogConflictError) {
        setError("Something else changed while this was posting. Check your pieces, then try again.");
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn't post that. Try again.");
    }
  }

  /** Ask before throwing work away; an untouched form just closes. */
  function requestClose() {
    if (dirty) setConfirmLeave(true);
    else onCancel();
  }

  /** Uploads already sent stay attached to the items, so a retry won't resend. */
  function cancelPublish() {
    abortRef.current?.abort();
    setCancelling(true);
  }

  const headerTitle = mode === "new" ? "New piece" : "Edit piece";
  const rightLabel = step === "pick" ? "Next" : mode === "new" ? "Share" : "Done";

  // The chevron goes back a step wherever there is one, and only closes at the
  // end of the line — where it now asks first.
  const backStep =
    step === "pick" ? (mode === "edit" ? "details" : null) : mode === "new" ? "pick" : null;
  const backLabel =
    backStep === "details" ? "Back to the details" : backStep === "pick" ? "Back to the photos" : "Close";

  return (
    <div className="screen composer">
      <ScreenHeader
        title={headerTitle}
        onBack={backStep ? () => setStep(backStep) : requestClose}
        backLabel={backLabel}
        backDisabled={busy}
        action={{
          label: rightLabel,
          disabled: busy || (step === "pick" ? items.length === 0 : false),
          onClick: step === "pick" ? () => setStep("details") : () => void share(),
        }}
      />

      <div className="screen-body">
        {step === "pick" ? (
          <>
            <p className="lede">Pick the photos and videos. The first one is the cover unless you say otherwise.</p>
            <label className="btn btn-primary btn-block file-btn">
              Choose from your phone
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={e => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>

            {fileNotes.length > 0 && (
              <ul className="file-notes">
                {fileNotes.map(note => (
                  <li key={note.id}>
                    <span>{note.text}</span>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setFileNotes(prev => prev.filter(n => n.id !== note.id))}
                    >
                      Got it
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {(items.length > 0 || skippedCount > 0) && (
              <p className="media-tally">
                {items.length} ready to post
                {skippedCount > 0 &&
                  `, ${skippedCount} ${skippedCount === 1 ? "file" : "files"} couldn't be added`}
              </p>
            )}

            {lastRemoved && (
              <div className="file-notes media-undo">
                <span>Took out one {nounFor(lastRemoved.item.kind)}.</span>
                <button type="button" className="btn btn-small" onClick={undoRemove}>
                  Put it back
                </button>
              </div>
            )}

            {items.length > 0 && (
              <ul className="media-list">
                {items.map((item, i) => {
                  const noun = nounFor(item.kind);
                  const isCover = cover === item.id;
                  return (
                    <li key={item.id} className="media-row">
                      <div className={`strip-thumb ${isCover ? "strip-thumb-cover" : ""}`.trim()}>
                        {item.kind === "video" ? (
                          <video src={srcOf(item)} muted playsInline preload="metadata" />
                        ) : (
                          <img src={srcOf(item)} alt="" />
                        )}
                        {isCover && <span className="strip-cover-flag">Cover</span>}
                        {/* Off on its own corner, so a thumb aimed at Make cover
                            can't land on it. */}
                        <button
                          type="button"
                          className="media-remove"
                          onClick={() => removeItem(item.id)}
                          aria-label={`Take out ${noun} ${i + 1}`}
                        >
                          ×
                        </button>
                      </div>
                      <div className="media-row-body">
                        <p className="media-position">
                          {noun === "video" ? "Video" : "Photo"} {i + 1} of {items.length}
                        </p>
                        <div className="strip-actions">
                          <button
                            type="button"
                            className="btn btn-small"
                            onClick={() => moveItem(item.id, -1)}
                            disabled={i === 0}
                            aria-label={`Move ${noun} ${i + 1} up`}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className="btn btn-small"
                            onClick={() => moveItem(item.id, 1)}
                            disabled={i === items.length - 1}
                            aria-label={`Move ${noun} ${i + 1} down`}
                          >
                            Down
                          </button>
                        </div>
                        <button
                          type="button"
                          className="btn btn-small btn-block"
                          disabled={isCover}
                          onClick={() => setCoverItemId(item.id)}
                        >
                          {isCover ? "Cover" : "Make cover"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <>
            {items.length > 0 && (
              <div className="caption-list">
                {items.map(item => (
                  <div key={item.id} className="caption-row">
                    <div className="caption-thumb">
                      {item.kind === "video" ? (
                        <video src={srcOf(item)} muted playsInline preload="metadata" />
                      ) : (
                        <img src={srcOf(item)} alt="" />
                      )}
                    </div>
                    <label className="field">
                      <span>What's in this {nounFor(item.kind)}?</span>
                      <input
                        type="text"
                        value={item.caption}
                        onChange={e => setCaption(item.id, e.target.value)}
                        placeholder="e.g. Gold leaf detail, close up"
                      />
                    </label>
                  </div>
                ))}
              </div>
            )}

            <button type="button" className="btn btn-plain btn-block" onClick={() => setStep("pick")}>
              {items.length ? "Change the photos" : "Add photos"}
            </button>

            <label className="field">
              <span>Title</span>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Studio Vessel No. 5"
              />
            </label>

            <div className="field-row">
              <label className="field">
                <span>Price (CAD)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={priceStr}
                  onChange={e => setPriceStr(e.target.value)}
                  placeholder="Blank = price on request"
                  aria-describedby="price-hint"
                />
              </label>
              <label className="field">
                <span>Year</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={yearStr}
                  onChange={e => setYearStr(e.target.value)}
                  placeholder="2026"
                />
              </label>
            </div>

            <p className="field-hint" id="price-hint">
              {priceStr.trim() !== "" && parsePrice(priceStr) == null
                ? "That price has something in it that isn't a number — it'll post as price on request."
                : "Leave it blank and the shop asks people to enquire."}
            </p>

            <label className="field">
              <span>How many do you have?</span>
              <input
                type="text"
                inputMode="numeric"
                value={status === "sold" ? "0" : quantityStr}
                disabled={status === "sold"}
                onChange={e => setQuantityStr(e.target.value)}
              />
            </label>
            <p className="field-hint">
              {status === "sold"
                ? "Marked sold, so the website shows none left."
                : "0 means the website shows this as sold out."}
            </p>
            {inventoryPrefillFailed && (
              <p className="field-hint field-hint-warn">
                Couldn't check your stock — posting now will overwrite the count and notes there with what's here.
              </p>
            )}

            <fieldset className="chips">
              <legend>What is it?</legend>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`chip${category === value ? " chip-on" : ""}`}
                  aria-pressed={category === value}
                  onClick={() => setCategory(value as PieceCategory)}
                >
                  {label}
                </button>
              ))}
            </fieldset>

            <fieldset className="chips">
              <legend>Status</legend>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`chip${status === value ? " chip-on" : ""}`}
                  aria-pressed={status === value}
                  onClick={() => setStatus(value as PieceStatus)}
                >
                  {label}
                </button>
              ))}
            </fieldset>
            <p className="field-hint">Draft keeps it off the website until you're ready.</p>

            <label className="field">
              <span>Short line for the grid</span>
              <textarea rows={2} value={blurb} onChange={e => setBlurb(e.target.value)} />
            </label>

            <label className="field">
              <span>The full description</span>
              <textarea rows={5} value={description} onChange={e => setDescription(e.target.value)} />
            </label>

            <label className="field">
              <span>Materials</span>
              <input
                type="text"
                value={materials}
                onChange={e => setMaterials(e.target.value)}
                placeholder="e.g. Plaster, gold leaf"
              />
            </label>

            <section className="size-section">
              <h2>Size</h2>

              <label className="field">
                <span>Units</span>
                <select value={unit} onChange={e => setUnit(e.target.value as SizeUnit)}>
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
                  <input
                    type="text"
                    inputMode="decimal"
                    value={heightStr}
                    onChange={e => setHeightStr(e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="field">
                  <span>Width</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={lengthStr}
                    onChange={e => setLengthStr(e.target.value)}
                    placeholder="0"
                  />
                </label>
              </div>

              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={hasDepth}
                  onChange={e => {
                    // Clear the value too, not just the field — a stale depth
                    // would still print in the size and draw in the preview.
                    if (!e.target.checked) setDepthStr("");
                    setHasDepth(e.target.checked);
                  }}
                />
                <span>This piece is 3D (has depth)</span>
              </label>

              {hasDepth && (
                <label className="field">
                  <span>Depth</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={depthStr}
                    onChange={e => setDepthStr(e.target.value)}
                    placeholder="0"
                  />
                </label>
              )}

              <ScaleFigure size={size} formatted={formatSize(previewPiece)} />

              <label className="field">
                <span>Or say the size in words (only if it has no fixed measurements)</span>
                <input
                  type="text"
                  value={dimensions}
                  onChange={e => setDimensions(e.target.value)}
                  placeholder='e.g. "Sized to the wall"'
                />
              </label>
            </section>

            <label className="field">
              <span>Private note — only you ever see this</span>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} />
            </label>
          </>
        )}
      </div>

      {(busy || error) && (
        <div className="post-status" role="status">
          {phase?.name === "uploading" && (
            <>
              <p>
                {cancelling
                  ? "Stopping. Nothing more will be sent."
                  : `Sending ${phase.done + 1} of ${phase.total}`}
              </p>
              <div className="progress">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.round(((phase.done + phase.fraction) / phase.total) * 100)}%` }}
                />
              </div>
              <button
                type="button"
                className="btn btn-small cancel-publish"
                onClick={cancelPublish}
                disabled={cancelling}
              >
                {cancelling ? "Stopping…" : "Cancel"}
              </button>
            </>
          )}
          {phase?.name === "posting" && <p>Posting…</p>}
          {error && (
            <div className="post-error">
              <p>{error}</p>
              <button type="button" className="btn btn-primary" onClick={() => void share()}>
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      {confirmLeave && (
        <ConfirmDialog
          title="Leave without saving?"
          body="The changes you made here won't be kept."
          confirmLabel="Leave"
          cancelLabel="Keep editing"
          onConfirm={onCancel}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </div>
  );
}
