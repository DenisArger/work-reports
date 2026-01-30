import "dotenv/config";
import http from "node:http";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

// Динамически импортируем handler из api/telegram.ts
let handler = null;

async function loadHandler() {
  if (!handler) {
    const module = await import("../api/telegram.js");
    handler = module.default;
  }
  return handler;
}

// Собираем тело запроса
function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

// Создаем Web API-совместимый Request из Node.js http.IncomingMessage
async function createRequest(req, body) {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );

  return new Request(url.toString(), {
    method: req.method,
    headers: req.headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );

  console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname}`);

  // Health check
  if (url.pathname === "/" || url.pathname === "/health") {
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("OK\n");
    return;
  }

  // Telegram webhook endpoint
  if (url.pathname === "/api/telegram") {
    try {
      const body = await collectBody(req);
      const webRequest = await createRequest(req, body);

      const h = await loadHandler();
      const response = await h(webRequest);

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      const responseBody = await response.text();
      res.end(responseBody);

      console.log(`  -> ${response.status}`);
    } catch (err) {
      console.error("Handler error:", err);
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain");
      res.end("Internal Server Error\n");
    }
    return;
  }

  // 404 для остальных путей
  res.statusCode = 404;
  res.setHeader("content-type", "text/plain");
  res.end("Not Found\n");
});

server.listen(port, host, () => {
  console.log("");
  console.log("=".repeat(50));
  console.log("  Worker Reports Bot - Dev Server");
  console.log("=".repeat(50));
  console.log(`  Local:    http://${host}:${port}`);
  console.log(`  Webhook:  http://${host}:${port}/api/telegram`);
  console.log("");
  console.log("  Для работы с Telegram:");
  console.log("  1. Запустите ngrok: ngrok http 3000");
  console.log("  2. Установите webhook: yarn webhook:local");
  console.log("=".repeat(50));
  console.log("");
});
