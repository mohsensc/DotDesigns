type Props = {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  /** Sits on the right when there's no action — the "…" button on a piece. */
  extra?: React.ReactNode;
};

// Same bar on every screen: back on the left, where she is in the middle,
// the one thing to do next on the right.
export default function ScreenHeader({ title, onBack, backLabel = "Back", action, extra }: Props) {
  return (
    <header className="screen-header">
      <div className="screen-header-side">
        {onBack && (
          <button type="button" className="icon-btn" onClick={onBack} aria-label={backLabel}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                d="M15 5 8 12l7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>

      <h1 className="screen-header-title">{title}</h1>

      <div className="screen-header-side screen-header-right">
        {action && (
          <button
            type="button"
            className="header-action"
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        )}
        {extra}
      </div>
    </header>
  );
}
