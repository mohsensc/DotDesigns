import type { VercelRequest, VercelResponse } from "@vercel/node";
import { del } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireUnlocked } from "./_lib/studio-lockdown";

// Photos and video go straight from her phone to Vercel Blob — the file never
// passes through a function, so a 60MB video isn't a 60MB request body.
//
// This endpoint only hands out a short-lived upload token, and only to a live
// studio session. Without that check the token is a public write door onto the
// site's storage.
//
//   POST          -> the two-step handshake @vercel/blob/client does
//   DELETE {url}  -> remove one blob
//
// Needs BLOB_READ_WRITE_TOKEN on the studio project.

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const method = req.method ?? "POST";

  if (method === "DELETE") {
    if (!(await requireUnlocked(req))) {
      res.status(401).json({ error: "Not signed in." });
      return;
    }
    const body = (typeof req.body === "string" ? safeJson(req.body) : req.body) as { url?: unknown };
    const url = typeof body?.url === "string" ? body.url : "";
    if (!url) {
      res.status(400).json({ error: "Missing url." });
      return;
    }
    try {
      await del(url);
      res.status(200).json({ ok: true });
    } catch {
      res.status(502).json({ error: "Couldn't delete that file." });
    }
    return;
  }

  if (method !== "POST") {
    res.setHeader("Allow", "POST, DELETE");
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  // Check session before handleUpload runs at all: handleUpload fails on a
  // missing BLOB_READ_WRITE_TOKEN before onBeforeGenerateToken ever fires, so
  // that check alone can't tell "not signed in" from "not configured".
  if (!(await requireUnlocked(req))) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }

  // No onUploadCompleted on purpose. With one set, Blob POSTs a signed
  // webhook back here with no session cookie, which the gate above would 401.
  // The catalog write happens on save anyway.
  try {
    const result = await handleUpload({
      request: req,
      body: req.body as HandleUploadBody,
      onBeforeGenerateToken: async pathname => {
        // The client picks the pathname, so the pieces/ prefix is only real if
        // it's checked here.
        if (!pathname.startsWith("pieces/") || pathname.includes("..")) {
          throw new Error("Files go under pieces/.");
        }
        return {
          allowedContentTypes: ALLOWED,
          addRandomSuffix: true,
          maximumSizeInBytes: 200 * 1024 * 1024,
        };
      },
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed." });
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
