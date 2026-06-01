import type { VercelRequest, VercelResponse } from "@vercel/node";

// Vercel serverless function — the Node backend's health endpoint.
// Available at /api/health on the deployed site.
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    status: "ok",
    service: "dot-designs",
    time: new Date().toISOString(),
  });
}
