#!/usr/bin/env node
// Two Vercel projects — the public shop and Hajar's private studio — build
// from this one repo. DEPLOY_TARGET picks which Vite entry gets built, but
// vercel.json's outputDirectory is fixed to `dist` at the repo root (both
// projects share the file, it can't branch per-project), so whichever target
// runs, the result has to land there.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, cpSync, renameSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = path.join(repoRoot, "client");
const clientDist = path.join(clientDir, "dist");
const outDir = path.join(repoRoot, "dist");

const isStudio = process.env.DEPLOY_TARGET === "studio";
const target = isStudio ? "studio" : "public";

// Kept in sync by hand with client/src/lib/seo.ts — this script is plain Node
// and can't import that TS module, so the strings are duplicated. Change one,
// change the other.
const SITE_ORIGIN = "https://dotdesigns.art";
const SITE_NAME = "DOT Designs";
const SITE_DESCRIPTION =
  "DOT Designs — a scroll-scrubbed camera flight through the DOT gallery of sculptural wall art. Hand-made relief, the signature Gold Wave, and bespoke plaster-and-gold finishes.";

// Real routes that aren't pieces. Kept next to the site consts so adding a page
// to App.tsx and forgetting it here is at least visible in one place.
const STATIC_PAGES = [
  {
    route: "/shop/request",
    title: "Special Request",
    description:
      "Commission a piece for your space. Tell us the room, the scale, and the budget, from small pottery to an on-site wall installation.",
  },
  {
    route: "/cover",
    title: "Cover",
    description: SITE_DESCRIPTION,
  },
];

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: clientDir, stdio: "inherit", env: process.env });
}

console.log(`[build] target: ${target}`);
run("npm", ["install"]);
run("npm", ["run", "build"]);

// The studio's Vite entry is studio.html, so that's what Vite emits — Vercel's
// static rewrite and the bare root URL both expect index.html, so rename it.
if (isStudio) {
  const studioHtml = path.join(clientDist, "studio.html");
  const indexHtml = path.join(clientDist, "index.html");
  if (!existsSync(studioHtml)) {
    throw new Error(`[build] expected ${studioHtml} after studio build, not found`);
  }
  renameSync(studioHtml, indexHtml);
}

if (!existsSync(path.join(clientDist, "index.html"))) {
  throw new Error(`[build] ${clientDist}/index.html missing after build`);
}

rmSync(outDir, { recursive: true, force: true });
cpSync(clientDist, outDir, { recursive: true });
console.log(`[build] wrote ${outDir}`);

if (isStudio) {
  // Hajar's listing tool is private — nothing here should be indexed, and
  // nothing should tell a crawler what hostname it lives on.
  writeFileSync(path.join(outDir, "robots.txt"), "User-agent: *\nDisallow: /\n");
  console.log("[build] wrote studio robots.txt (disallow all)");
  // The studio build skips public/ (39MB of film), but the size drawing in
  // the composer still needs the two scale figures. Copy just those.
  cpSync(path.join(clientDir, "public", "scale"), path.join(outDir, "scale"), { recursive: true });
  console.log("[build] copied scale figures for the studio");
} else {
  await prerenderPublicSite();
}

// ---------------------------------------------------------------------------
// Prerendering. Crawlers (Facebook, iMessage, WhatsApp, Slack, Google) don't
// run JavaScript, so a client-rendered SPA with one static <title> and no
// OpenGraph tags shows nothing in a shared link. This writes real, distinct
// HTML per piece — and for the shop index and the site root — with the head
// tags baked in at build time.
// ---------------------------------------------------------------------------

async function prerenderPublicSite() {
  const catalog = await loadCatalogForPrerender();
  const pieces = catalog.pieces.filter(p => p.status !== "draft").sort((a, b) => a.order - b.order);

  const template = readFileSync(path.join(outDir, "index.html"), "utf8");

  // Site root gets the same treatment as everything else: replace, don't append.
  const rootHead = buildHead({
    title: `${SITE_NAME} - Sculptural Walls`,
    description: SITE_DESCRIPTION,
    url: `${SITE_ORIGIN}/`,
    image: ogImageFor(null),
    type: "website",
    jsonLd: null,
  });
  writeFileSync(path.join(outDir, "index.html"), injectHead(template, rootHead));

  // Shop index.
  const shopHead = buildHead({
    title: `Shop — ${SITE_NAME}`,
    description: "Available sculptural wall relief, sculpture, and pottery, made by hand — DOT Designs.",
    url: `${SITE_ORIGIN}/shop`,
    image: ogImageFor(null),
    type: "website",
    jsonLd: null,
  });
  const shopDir = path.join(outDir, "shop");
  mkdirSync(shopDir, { recursive: true });
  writeFileSync(path.join(shopDir, "index.html"), injectHead(template, shopHead));

  // Routes with no prerendered file fall through to the rewritten root, which
  // would hand them the site's canonical — telling Google they're duplicates of
  // the home page. These two are real pages, so they get their own.
  for (const page of STATIC_PAGES) {
    const head = buildHead({
      title: `${page.title} — ${SITE_NAME}`,
      description: page.description,
      url: `${SITE_ORIGIN}${page.route}`,
      image: ogImageFor(null),
      type: "website",
      jsonLd: null,
    });
    const dir = path.join(outDir, ...page.route.split("/").filter(Boolean));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.html"), injectHead(template, head));
  }

  // Per-piece pages.
  for (const piece of pieces) {
    const url = `${SITE_ORIGIN}/shop/${piece.slug}`;
    const image = ogImageFor(piece.slug);
    const description = truncateDescription(piece.blurb || piece.description);
    const head = buildHead({
      title: `${piece.title} — ${SITE_NAME}`,
      description,
      url,
      image,
      type: "product",
      jsonLd: productJsonLd(piece, url, image),
    });
    const pieceDir = path.join(shopDir, piece.slug);
    mkdirSync(pieceDir, { recursive: true });
    writeFileSync(path.join(pieceDir, "index.html"), injectHead(template, head));
  }
  console.log(`[build] prerendered ${pieces.length} piece page(s) + shop index + site root`);

  writeSitemapAndRobots(pieces);
}

/**
 * The live catalog if the site can be reached, the demo pieces otherwise.
 *
 * Prerendering exists for crawlers, and crawlers read the deployed site — so
 * the pieces to bake head tags for are the ones the deployed site is serving,
 * not whatever was committed. A build must never fail over this, hence the
 * timeout and the fallback.
 */
async function loadCatalogForPrerender() {
  const url = `${SITE_ORIGIN}/api/catalog`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const catalog = body?.catalog ?? body;
    if (catalog?.version !== 1 || !Array.isArray(catalog.pieces)) throw new Error("not a catalog");
    console.log(`[build] catalog: ${url} (${catalog.pieces.length} pieces)`);
    return catalog;
  } catch (err) {
    console.log(`[build] catalog: shared/catalog.demo.json (${url} failed: ${err.message})`);
    return JSON.parse(readFileSync(path.join(repoRoot, "shared", "catalog.demo.json"), "utf8"));
  }
}

/** `client/public/og/<slug>.jpg` if it exists, else the default preview. */
function ogImageFor(slug) {
  if (slug) {
    const file = path.join(clientDir, "public", "og", `${slug}.jpg`);
    if (existsSync(file)) return `${SITE_ORIGIN}/og/${slug}.jpg`;
  }
  return `${SITE_ORIGIN}/og/default.jpg`;
}

/** Newlines collapsed to spaces, truncated to ~160 chars at a word boundary. */
function truncateDescription(text) {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 160) return collapsed;
  const cut = collapsed.slice(0, 160);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : 160).trimEnd()}…`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function productJsonLd(piece, url, image) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: piece.title,
    description: truncateDescription(piece.blurb || piece.description),
    image,
    sku: piece.id,
    material: piece.materials,
    brand: { "@type": "Brand", name: SITE_NAME },
  };
  if (piece.price != null) {
    const availability = {
      available: "https://schema.org/InStock",
      sold: "https://schema.org/SoldOut",
      reserved: "https://schema.org/PreOrder",
    }[piece.status];
    ld.offers = {
      "@type": "Offer",
      url,
      priceCurrency: "CAD",
      price: piece.price,
      availability,
    };
  }
  return ld;
}

function buildHead({ title, description, url, image, type, jsonLd }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(url);
  const img = escapeHtml(image);
  const lines = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<link rel="canonical" href="${u}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:image" content="${img}" />`,
    `<meta property="og:url" content="${u}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${img}" />`,
  ];
  if (jsonLd) {
    // Escape "<" so a "</script" inside a string value (title, description, ...)
    // can't break out of the script block.
    const json = JSON.stringify(jsonLd).replace(/</g, "\\u003c");
    lines.push(`<script type="application/ld+json">${json}</script>`);
  }
  return lines.join("\n    ");
}

/** Replace the template's <title> and meta description, don't append duplicates. */
function injectHead(html, headMarkup) {
  let out = html.replace(/<title>.*?<\/title>/s, "");
  out = out.replace(/<meta\s+name="description"[^>]*\/?>/s, "");
  // Function form: headMarkup can contain piece text with "$&", "$1", etc. —
  // the string form of .replace() would treat those as replacement patterns.
  return out.replace("</head>", () => `    ${headMarkup}\n  </head>`);
}

function writeSitemapAndRobots(pieces) {
  // /cover is deliberately absent: it's the superseded editorial page, kept
  // reachable but not something to invite search traffic to.
  const urls = [
    `${SITE_ORIGIN}/`,
    `${SITE_ORIGIN}/shop`,
    ...pieces.map(p => `${SITE_ORIGIN}/shop/${p.slug}`),
    `${SITE_ORIGIN}/shop/request`,
  ];
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${escapeHtml(u)}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  writeFileSync(path.join(outDir, "sitemap.xml"), sitemap);

  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
  writeFileSync(path.join(outDir, "robots.txt"), robots);
  console.log(`[build] wrote sitemap.xml (${urls.length} urls) + robots.txt`);
}
