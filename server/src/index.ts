import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3001;

// Path to the built client. In dev the file may not exist yet (Vite serves the
// client directly); in production `npm run build` populates client/dist.
const clientDist = path.resolve(__dirname, "../../client/dist");

// --- API ---
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "dot-designs", time: new Date().toISOString() });
});

// --- Static client + SPA fallback ---
app.use(express.static(clientDist));

app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) {
      res
        .status(503)
        .send(
          "Client build not found. Run `npm run build` first, then `npm start`.\n" +
            "For development use `npm run dev` and open http://localhost:5173",
        );
    }
  });
});

app.listen(PORT, () => {
  console.log(`Dot Designs server listening on http://localhost:${PORT}`);
});
