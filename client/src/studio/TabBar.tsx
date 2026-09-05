export type Tab = "home" | "stock";

type Props = {
  tab: Tab;
  onTab: (tab: Tab) => void;
  onNewPost: () => void;
};

// Three targets, thumb height, nothing hidden behind a menu.
export default function TabBar({ tab, onTab, onNewPost }: Props) {
  return (
    <nav className="tab-bar" aria-label="Studio">
      <button
        type="button"
        className={`tab-btn${tab === "home" ? " tab-btn-on" : ""}`}
        onClick={() => onTab("home")}
        aria-current={tab === "home" ? "page" : undefined}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path
            d="M4 10.5 12 4l8 6.5V20H4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
        <span>Pieces</span>
      </button>

      <button type="button" className="tab-btn tab-btn-new" onClick={onNewPost}>
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 8.5v7M8.5 12h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span>New</span>
      </button>

      <button
        type="button"
        className={`tab-btn${tab === "stock" ? " tab-btn-on" : ""}`}
        onClick={() => onTab("stock")}
        aria-current={tab === "stock" ? "page" : undefined}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path
            d="M4 7h16M4 12h16M4 17h16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <span>Stock</span>
      </button>
    </nav>
  );
}
