#!/usr/bin/env node
// Two Vercel projects — the public shop and Hajar's private studio — build
// from this one repo. DEPLOY_TARGET picks which Vite entry gets built, but
// vercel.json's outputDirectory is fixed to `dist` at the repo root (both
// projects share the file, it can't branch per-project), so whichever target
// runs, the result has to land there.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, cpSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = path.join(repoRoot, "client");
const clientDist = path.join(clientDir, "dist");
const outDir = path.join(repoRoot, "dist");

const isStudio = process.env.DEPLOY_TARGET === "studio";
const target = isStudio ? "studio" : "public";

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
