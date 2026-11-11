import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress, normalizeAddress } from "./core/address.js";
import { openDatabase } from "./db.js";
import { createEngine } from "./engine.js";
import { createBlockscout } from "./sources/blockscout.js";
import { createDexScreener } from "./sources/dexscreener.js";
import { createRpc } from "./sources/rpc.js";
import { telegramCall } from "./sources/telegram.js";
import { assertTelegramConfig, assertTelegramToken } from "./core/telegram.js";
import { createTelegramNotifier } from "./telegram.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(new Error("Invalid JSON")); }
    });
    request.on("error", reject);
  });
}

function send(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(JSON.stringify(body));
}

function millis(value) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 1_000_000_000_000) throw new Error("Timestamp must be unix milliseconds");
  return value;
}

export async function startServer(options = {}) {
  const db = openDatabase(options.dbPath ?? path.join(root, "data", "tracker.db"));
  const telegram = createTelegramNotifier({
    db,
    call: options.telegramCall ?? telegramCall,
    envToken: options.telegramEnv?.token ?? "",
    envChatId: options.telegramEnv?.chatId ?? "",
  });
  const engine = createEngine({
    db,
    rpc: options.rpc ?? createRpc(),
    blockscout: options.blockscout ?? createBlockscout(),
    dex: options.dex ?? createDexScreener(),
    goplus: options.goplus,
    dextools: options.dextools,
    trending: options.trending,
    onAlerts: () => telegram.flush(),
  });
  if (options.watch !== false) engine.start();
  telegram.start();

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "OPTIONS") return send(response, 204, {});
      if (request.method === "GET" && url.pathname === "/api/health") {
        return send(response, 200, { ok: true, ...engine.status, telegram: telegram.status() });
      }
      if (request.method === "GET" && url.pathname === "/api/telegram") {
        return send(response, 200, telegram.status());
      }
      if (request.method === "DELETE" && url.pathname === "/api/telegram") {
        return send(response, 200, telegram.disable());
      }
      if (request.method === "POST" && url.pathname === "/api/telegram/discover") {
        const body = await readBody(request);
        const token = assertTelegramToken(String(body.token ?? "").trim() || telegram.token() || "");
        const found = await telegram.discover(token);
        if (!found.ok) return send(response, 400, { error: found.description });
        return send(response, 200, { chatId: found.chatId });
      }
      if (request.method === "POST" && url.pathname === "/api/telegram/test") {
        await telegram.sendTest();
        return send(response, 200, { ok: true, ...telegram.status() });
      }
      if (request.method === "POST" && url.pathname === "/api/telegram") {
        const body = await readBody(request);
        const token = String(body.token ?? "").trim() || telegram.token() || "";
        const config = assertTelegramConfig(token, body.chatId);
        const me = await telegram.check(config.token);
        if (!me.ok) return send(response, 400, { error: me.description });
        return send(response, 200, telegram.save(config));
      }
      if (request.method === "GET" && url.pathname === "/api/competitors") {
        return send(response, 200, db.listCompetitors());
      }
      if (request.method === "POST" && url.pathname === "/api/competitors") {
        const body = await readBody(request);
        const label = String(body.label ?? "").trim();
        const watchKind = body.watchKind === "creator" ? "creator" : body.watchKind === "funder" ? "funder" : "";
        if (!label || label.length > 64) return send(response, 400, { error: "Label is required" });
        if (!watchKind || !isAddress(body.address)) return send(response, 400, { error: "Address and watch type are required" });
        try {
          const row = db.insertCompetitor({ label, address: normalizeAddress(body.address), watchKind });
          return send(response, 201, row);
        } catch (error) {
          if (/UNIQUE/i.test(error.message)) return send(response, 409, { error: "That competitor is already saved" });
          throw error;
        }
      }
      const competitorMatch = url.pathname.match(/^\/api\/competitors\/(\d+)$/);
      if (request.method === "DELETE" && competitorMatch) {
        const removed = db.deleteCompetitor(Number(competitorMatch[1]));
        return send(response, removed ? 200 : 404, { removed });
      }
      if (request.method === "GET" && url.pathname === "/api/tokens") {
        return send(response, 200, db.listTokens());
      }
      if (request.method === "POST" && url.pathname === "/api/tokens/classify") {
        const body = await readBody(request);
        if (!isAddress(body.address)) return send(response, 400, { error: "Token address is required" });
        const result = await engine.classifyToken(body.address, { countSwaps: body.countSwaps !== false });
        return send(response, 200, result);
      }
      if (request.method === "POST" && url.pathname === "/api/dextools") {
        const body = await readBody(request);
        if (!isAddress(body.address)) return send(response, 400, { error: "Token address is required" });
        const result = await engine.applyDexTools({
          address: body.address,
          infoAt: millis(body.infoAt),
          nitroAt: millis(body.nitroAt),
          hotRank: body.hotRank == null ? null : Number(body.hotRank),
          banned: body.banned === true,
        });
        return send(response, 200, result);
      }
      if (request.method === "GET" && url.pathname === "/api/alerts") {
        return send(response, 200, db.listAlerts());
      }
      if (request.method === "GET" && url.pathname === "/api/alerts/pending") {
        return send(response, 200, db.pendingAlerts());
      }
      if (request.method === "POST" && url.pathname === "/api/alerts/delivered") {
        const body = await readBody(request);
        db.markDelivered(Array.isArray(body.ids) ? body.ids : []);
        return send(response, 200, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/api/trending/refresh") {
        return send(response, 200, await engine.refreshTrending());
      }
      const pages = { "/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/app.css": "app.css" };
      if (request.method === "GET" && pages[url.pathname]) {
        const filePath = path.join(publicDir, pages[url.pathname]);
        const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
        response.writeHead(200, { "content-type": types[path.extname(filePath)] });
        response.end(fs.readFileSync(filePath));
        return;
      }
      send(response, 404, { error: "Not found" });
    } catch (error) {
      const status = error.status ?? (/required|Timestamp|Classify|not found|No inbound|Telegram/i.test(error.message) ? 400 : 500);
      const message = String(error.message ?? "").replace(/bot\d{6,12}:[A-Za-z0-9_-]{30,}/g, "bot[token]");
      send(response, status, { error: message });
    }
  });

  await new Promise((resolve) => server.listen(options.port ?? 8787, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    db,
    engine,
    async close() {
      telegram.stop();
      engine.stop();
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      db.close();
    },
  };
}
