import { useEffect, useId, useRef } from "react";

type Props = {
  title: string;
  body: string;
  confirmLabel: string;
  /** Defaults to "Cancel". Say what staying does when that reads better. */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

// One confirm step, for the things that can't be undone. Plain language,
// no icons — just say what happens.
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      // Tab stays inside the card. Two buttons, so it just alternates.
      if (e.key === "Tab" && cardRef.current) {
        const focusable = cardRef.current.querySelectorAll<HTMLElement>("button");
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Focus the safe button, not the destructive one — Enter shouldn't confirm.
  // On close, put focus back where it came from.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        ref={cardRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        <p>{body}</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-plain" ref={cancelRef} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
