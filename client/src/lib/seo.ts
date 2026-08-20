// Site-level SEO constants shared across the app.
//
// scripts/build.mjs bakes the same strings into the prerendered HTML head at
// build time (it can't import this file — it's plain Node, this is TS), so the
// two must be kept in sync by hand. If you change SITE_NAME, SITE_DESCRIPTION,
// or SITE_ORIGIN here, change the matching consts at the top of build.mjs too.

export const SITE_ORIGIN = "https://dotdesigns.art";
export const SITE_NAME = "DOT Designs";
export const SITE_DESCRIPTION =
  "DOT Designs — a scroll-scrubbed camera flight through the DOT gallery of sculptural wall art. Hand-made relief, the signature Gold Wave, and bespoke plaster-and-gold finishes.";

type SeoPiece = {
  title: string;
  blurb: string;
  description: string;
};

/** Matches the <title> the prerender writes for this piece's page. */
export function pieceTitle(piece: SeoPiece): string {
  return `${piece.title} — ${SITE_NAME}`;
}

/**
 * Matches the meta description the prerender writes: the blurb when there is
 * one (it's already written as a one- or two-line summary), otherwise the
 * long description, newlines collapsed and truncated to ~160 chars at a word
 * boundary — same rule as truncateDescription() in scripts/build.mjs.
 */
export function pieceDescription(piece: SeoPiece): string {
  const collapsed = (piece.blurb || piece.description).replace(/\s+/g, " ").trim();
  if (collapsed.length <= 160) return collapsed;
  const cut = collapsed.slice(0, 160);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : 160).trimEnd()}…`;
}
