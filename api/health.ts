import { VercelRequest, VercelResponse } from "@vercel/node";

const DEBUG_INGEST =
  "http://127.0.0.1:7243/ingest/9acac06f-fa87-45a6-af60-73458650b939";

export default function handler(req: VercelRequest, res: VercelResponse) {
  // #region agent log
  fetch(DEBUG_INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: "api/health.ts:handler",
      message: "health handler invoked",
      data: { method: req.method, url: req.url },
      timestamp: Date.now(),
      sessionId: "debug-session",
      hypothesisId: "H2",
    }),
  }).catch(() => {});
  console.log("Health check called");
  // #endregion
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    path: "/api/health",
  });
}
