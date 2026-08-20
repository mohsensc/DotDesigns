import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Vite dev server runs on 5173 and proxies API calls to the Express server (3001).
// Production build is emitted to client/dist, then scripts/build.mjs copies it
// to the repo-root dist/ that Vercel deploys.
//
// One repo builds two sites: the public shop (default) and Hajar's private
// studio (DEPLOY_TARGET=studio). The only difference is which HTML file Vite
// treats as the entry — everything else about the build is identical, and the
// default path is untouched so the public site's output shape never changes.
const isStudio = process.env.DEPLOY_TARGET === "studio";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  // public/ is 39MB of scroll-film video and the ambient track — all of it for
  // the public site, none of it for the studio. Vite copies public/ wholesale
  // regardless of entry, so the studio build opts out rather than shipping a
  // private listing tool with the whole film bolted to it.
  publicDir: isStudio ? false : "public",
  build: {
    outDir: "dist",
    rollupOptions: isStudio
      ? { input: fileURLToPath(new URL("./studio.html", import.meta.url)) }
      : undefined,
  },
});
