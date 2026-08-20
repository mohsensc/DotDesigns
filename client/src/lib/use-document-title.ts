import { useEffect } from "react";

// Per-route titles for people navigating inside the app.
//
// This is only half the story: crawlers don't run JavaScript, so link previews
// and search results come from the static per-piece HTML that scripts/build.mjs
// prerenders. This hook exists so the browser tab and the back/forward history
// read correctly once the SPA has taken over. The two should say the same thing.

const SUFFIX = "DOT Designs";

export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title === SUFFIX ? title : `${title} — ${SUFFIX}`;
    // Restore on unmount so a route that sets no title can't inherit the last one.
    return () => {
      document.title = previous;
    };
  }, [title]);
}
