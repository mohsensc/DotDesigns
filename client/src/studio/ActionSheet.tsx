import { useEffect } from "react";

export type SheetItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
};

type Props = {
  items: SheetItem[];
  onClose: () => void;
};

// The "…" menu. Slides up from the bottom because that's where her thumb is.
export default function ActionSheet({ items, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="More actions" onClick={e => e.stopPropagation()}>
        {items.map(item => (
          <button
            key={item.label}
            type="button"
            className={`sheet-item${item.danger ? " sheet-item-danger" : ""}`}
            disabled={item.disabled}
            onClick={item.onClick}
          >
            {item.label}
          </button>
        ))}
        <button type="button" className="sheet-item sheet-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
