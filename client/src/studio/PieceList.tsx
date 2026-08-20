import { useState } from "react";
import { altOf, CATEGORY_LABELS, coverOf, formatPrice, STATUS_LABELS, type Piece } from "../lib/catalog.ts";
import ConfirmDialog from "./ConfirmDialog.tsx";
import MediaThumb from "./MediaThumb.tsx";

type Props = {
  pieces: Piece[];
  onAddNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onToggleSold: (id: string) => void;
  onDuplicate: (id: string) => void;
};

export default function PieceList({ pieces, onAddNew, onEdit, onDelete, onMove, onToggleSold, onDuplicate }: Props) {
  const [pendingDelete, setPendingDelete] = useState<Piece | null>(null);
  const sorted = [...pieces].sort((a, b) => a.order - b.order);

  return (
    <div className="piece-list">
      <div className="piece-list-header">
        <h1>Your pieces</h1>
        <button type="button" className="btn btn-primary" onClick={onAddNew}>
          Add a new piece
        </button>
      </div>

      {sorted.length === 0 && <p className="empty-note">No pieces yet. Add your first one above.</p>}

      <div className="piece-rows">
        {sorted.map((piece, i) => {
          const cover = coverOf(piece);
          return (
            <div key={piece.id} className="piece-card">
              <div className="piece-card-top">
                <div className="piece-row-thumb">
                  {cover ? <MediaThumb media={cover} alt={altOf(cover, piece)} /> : <div className="piece-row-thumb-empty" />}
                </div>

                <div className="piece-card-info">
                  <div className="piece-card-title">
                    {piece.title || "Untitled piece"}
                    <span className={`status-pill status-${piece.status}`}>{STATUS_LABELS[piece.status]}</span>
                  </div>
                  <div className="piece-card-meta">
                    {CATEGORY_LABELS[piece.category]} · {formatPrice(piece.price)}
                  </div>
                </div>
              </div>

              <div className="piece-card-actions">
                <button type="button" className="btn btn-plain btn-block" onClick={() => onEdit(piece.id)}>
                  Edit this piece
                </button>

                <button type="button" className="btn btn-plain btn-block" onClick={() => onToggleSold(piece.id)}>
                  {piece.status === "available" ? "Mark as sold" : "Mark as in stock"}
                </button>

                <button type="button" className="btn btn-plain btn-block" onClick={() => onDuplicate(piece.id)}>
                  Duplicate this piece
                </button>

                <div className="piece-card-move">
                  <button
                    type="button"
                    className="btn btn-plain"
                    disabled={i === 0}
                    onClick={() => onMove(piece.id, "up")}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="btn btn-plain"
                    disabled={i === sorted.length - 1}
                    onClick={() => onMove(piece.id, "down")}
                  >
                    Move down
                  </button>
                </div>

                <div className="piece-card-delete">
                  <button type="button" className="btn btn-danger btn-block" onClick={() => setPendingDelete(piece)}>
                    Delete this piece
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.title || "this piece"}"?`}
          body="This removes it and its photos and videos from this browser. It can't be undone."
          confirmLabel="Delete piece"
          onConfirm={() => {
            onDelete(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
