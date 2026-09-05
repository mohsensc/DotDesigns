// The catalog in Redis. One key, one JSON value, whole-document writes.
//
// A catalog is a few hundred KB at worst and only one person edits it, so
// per-piece keys would buy nothing but a way for the pieces to disagree with
// each other. The thing that actually needs care is two tabs saving over each
// other, and that's what the compare-and-set below is for.
//
// Nothing stored yet means the demo pieces. That's the shop's first day, not
// an error.

import { command, eval_, isConfigured } from "./redis";
import {
  CATALOG_KEY,
  CATALOG_STAMP_KEY,
  parseStoredCatalog,
} from "./catalog-shape";
import demo from "../../shared/catalog.demo.json";
import type { Catalog } from "../../client/src/lib/catalog";

export { isConfigured };

export const DEMO_CATALOG = demo as Catalog;

export async function readCatalog(): Promise<Catalog> {
  const raw = await command<string | null>(["GET", CATALOG_KEY]);
  return parseStoredCatalog(raw) ?? DEMO_CATALOG;
}

// Both keys are set in one script so the witness can never drift from the
// document it's a witness for. Returns "ok", or the updatedAt the caller
// should have sent — which is the 409.
const CAS_LUA = `
local seen = redis.call('GET', KEYS[2])
if not seen then seen = ARGV[3] end
if seen ~= ARGV[2] then return seen end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[4])
return 'ok'
`;

export type WriteResult = { ok: true; catalog: Catalog } | { ok: false; catalog: Catalog };

/**
 * Writes the whole catalog if nobody else has since `expectedUpdatedAt`.
 *
 * When nothing is stored the client was looking at the demo, so the demo's own
 * updatedAt is what it has to have sent. That keeps the very first save honest
 * instead of special-casing it into an unconditional overwrite.
 */
export async function writeCatalog(next: Catalog, expectedUpdatedAt: string): Promise<WriteResult> {
  const result = await eval_<string>(
    CAS_LUA,
    [CATALOG_KEY, CATALOG_STAMP_KEY],
    [JSON.stringify(next), expectedUpdatedAt, DEMO_CATALOG.updatedAt, next.updatedAt],
  );
  if (result === "ok") return { ok: true, catalog: next };
  return { ok: false, catalog: await readCatalog() };
}
