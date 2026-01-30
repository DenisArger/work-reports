import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

let handler = null;

async function loadHandler() {
  if (!handler) {
    const handlerPath = path.join(__dirname, "..", "dist", "api", "telegram.js");
    const module = await import(pathToFileURL(handlerPath).href);
    handler = module.default;
  }
  return handler;
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

/** Создаёт объект, совместимый с VercelRequest (method, body, headers, url). */
function createVercelReq(nodeReq, rawBody) {
  const url = new URL(
    nodeReq.url || "/",
    `http://${nodeReq.headers.host || "localhost"}`,
  );
  let body = rawBody;
  const contentType = (nodeReq.headers["content-type"] || "").toLowerCase();
  if (rawBody && contentType.includes("application/json")) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      // leave as string
    }
  }
  return {
    method: nodeReq.method,
    url: url.href,
    headers: nodeReq.headers,
    body,
    query: Object.fromEntries(url.searchParams),
  };
}

/** Создаёт объект, совместимый с VercelResponse (status, send, setHeader, затем отправить через nodeRes). */
function createVercelRes() {
  const res = {
    _status: 200,
    _headers: {},
    _body: null,
  };
  res.status = function (code) {
    this._status = code;
    return this;
  };
  res.send = function (body) {
    this._body = body === undefined ? "OK" : body;
    return this;
  };
  res.setHeader = function (name, value) {
    this._headers[String(name).toLowerCase()] = value;
    return this;
  };
  res.json = function (obj) {
    this.setHeader("content-type", "application/json");
    this._body = JSON.stringify(obj);
    return this;
  };
  return res;
}

function sendVercelResToNode(vercelRes, nodeRes) {
  nodeRes.statusCode = vercelRes._status;
  for (const [name, value] of Object.entries(vercelRes._headers)) {
    nodeRes.setHeader(name, value);
  }
  const body = vercelRes._body;
  if (body === null || body === undefined) {
    nodeRes.end();
  } else if (Buffer.isBuffer(body)) {
    nodeRes.end(body);
  } else {
    nodeRes.end(String(body));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );

  console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname}`);

  if (url.pathname === "/" || url.pathname === "/health") {
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("OK\n");
    return;
  }

  if (url.pathname === "/api/telegram") {
    try {
      const rawBody = await collectBody(req);
      const vercelReq = createVercelReq(req, rawBody);
      const vercelRes = createVercelRes();

      const h = await loadHandler();
      await h(vercelReq, vercelRes);

      sendVercelResToNode(vercelRes, res);
      console.log(`  -> ${vercelRes._status}`);
    } catch (err) {
      console.error("Handler error:", err);
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain");
      res.end("Internal Server Error\n");
    }
    return;
  }

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
