import type { VercelRequest, VercelResponse } from "@vercel/node";
import { DEMO_CATALOG, isConfigured, readCatalog } from "./_lib/catalog";
import { publicView } from "./_lib/catalog-shape";

// What the shop reads. Drafts stripped, sorted by display order.
//
// This endpoint never fails. A Redis blip that returned a 500 here would blank
// the shop — no pieces, no prices, nothing to look at — which is a far worse
// outcome than showing the demo pieces for thirty seconds. So storage trouble
// falls back to the demo catalog and the page still renders.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  let catalog = DEMO_CATALOG;
  if (isConfigured()) {
    try {
      catalog = await readCatalog();
    } catch {
      catalog = DEMO_CATALOG;
    }
  }

  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
  res.status(200).json({ catalog: publicView(catalog) });
}
