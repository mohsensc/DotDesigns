// Small shared helpers for the studio views.

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function slugify(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `piece-${Date.now()}`;
}
