import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatUnits } from "../src/core/format.js";
import { readDexTools } from "../src/sources/security.js";
import { startServer } from "../src/server.js";

const TOKEN = "0x0DC4BC369ff564543738EbB04f2F1e6F4343f3B7";
const CREATOR = "0x4c1c3bf1bcbef60852bd1fcb6039135e05a2d74a";
const FUNDER = "0x037741ef196087b26abfb173b64d05df23fadc72";
const FUNDING_TX = "0x473cb582b03f3f48f33f626dd6a23f1659c3488afd446c296c23fdf209b5d765";
const CREATE_BLOCK = 26341810;

async function api(url, pathname, options) {
  const response = await fetch(`${url}${pathname}`, options);
  const body = await response.json();
  return { status: response.status, body };
}

test("live Dacity classification matches the chain and does not repeat alerts", { timeout: 360000 }, async () => {
  const dbPath = path.join(os.tmpdir(), `tracker-${Date.now()}.db`);
  const server = await startServer({ dbPath, port: 0, watch: false });
  try {
    const created = await api(server.url, "/api/competitors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Binance 153", address: FUNDER, watchKind: "funder" }),
    });
    assert.equal(created.status, 201);

    const duplicate = await api(server.url, "/api/competitors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "again", address: FUNDER, watchKind: "funder" }),
    });
    assert.equal(duplicate.status, 409);

    const first = await api(server.url, "/api/tokens/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: TOKEN }),
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const token = first.body.token;
    assert.equal(token.creator, CREATOR);
    assert.equal(token.funder, FUNDER);
    assert.equal(token.fundingTx, FUNDING_TX);
    assert.equal(token.fundingValue, "497600000000000000");
    assert.equal(formatUnits(token.fundingValue, 18), "0.4976");
    assert.equal(token.competitorLabel, "Binance 153");
    assert.equal(token.symbol, "DACITY");
    assert.equal(token.dexPaidAt, 1793835981993);
    assert.equal(token.dexPaidStatus, "approved");
    assert.equal(token.quoteSymbol, "ETH");
    assert.equal(token.incomeExact, true, first.body.incomeError ?? "income was not exact");
    assert.equal(token.incomeNet, "0");
    assert.equal(first.body.lines.some((line) => line.hash === FUNDING_TX), false);
    assert.ok(Number(token.marketCap) > 0);
    assert.ok(Number(token.volumeH24) > 0);
    assert.ok(token.txH24 > 0);
    assert.ok(Number(token.pooledQuote) > 0);
    assert.equal(token.swapCountExact, true, first.body.swapError ?? "swap count was not finished");
    assert.ok(token.swapCount >= token.txH24, `swap count ${token.swapCount} is below the 24h tx count ${token.txH24}`);
    assert.ok(token.swapCount > 4000, `swap count ${token.swapCount} still looks truncated`);
    assert.equal(token.rugged, false);
    assert.equal(token.banStatus, "clear");
    assert.equal(token.dextoolsInfoAt, null);
    assert.equal(token.hotRank, null);
    assert.deepEqual(first.body.alerts.map((alert) => alert.kind).sort(), ["contract_started", "dexscreener_paid"]);

    const second = await api(server.url, "/api/tokens/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: TOKEN }),
    });
    assert.equal(second.body.alerts.length, 0);
    assert.ok(second.body.token.swapCount >= token.swapCount);
    const pending = await api(server.url, "/api/alerts/pending");
    assert.equal(pending.body.length, 2);
    const delivered = await api(server.url, "/api/alerts/delivered", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: pending.body.map((alert) => alert.id) }),
    });
    assert.equal(delivered.status, 200);
    assert.equal((await api(server.url, "/api/alerts/pending")).body.length, 0);

    const tools = await api(server.url, "/api/dextools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: TOKEN, infoAt: 1793835981993, nitroAt: 1793836000000, hotRank: 4 }),
    });
    assert.equal(tools.status, 200);
    assert.equal(tools.body.token.dextoolsInfoAt, 1793835981993);
    assert.equal(tools.body.token.hotRank, 4);
    assert.equal(tools.body.alerts.map((alert) => alert.kind).sort().join(), "dextools_paid,dextools_paid");
    const repeatTools = await api(server.url, "/api/dextools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: TOKEN, infoAt: 1793835981993, nitroAt: 1793836000000, hotRank: 4 }),
    });
    assert.equal(repeatTools.body.alerts.length, 0);
    const badTime = await api(server.url, "/api/dextools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: TOKEN, infoAt: "yesterday" }),
    });
    assert.equal(badTime.status, 400);

    const banned = await api(server.url, "/api/dextools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: TOKEN, banned: true }),
    });
    assert.equal(banned.body.token.banStatus, "banned");
    assert.equal(banned.body.alerts.some((alert) => alert.kind === "ban_changed"), true);

    const removed = await api(server.url, `/api/competitors/${created.body.id}`, { method: "DELETE" });
    assert.equal(removed.body.removed, true);
    assert.equal((await api(server.url, "/api/tokens")).body[0].competitorId, null);

    const block = await server.engine.inspectBlock(CREATE_BLOCK);
    assert.equal(block.creates.some((item) => item.contract === TOKEN.toLowerCase() && item.creator === CREATOR), true);
    assert.equal(block.tokens.includes(TOKEN.toLowerCase()), true);

    const dextools = await readDexTools();
    assert.equal(dextools.available, false);

    const trending = await api(server.url, "/api/trending/refresh", { method: "POST" });
    if (trending.body.available) {
      const ranked = (await api(server.url, "/api/tokens")).body[0].trendingRank;
      assert.ok(ranked == null || (Number.isInteger(ranked) && ranked > 0));
    } else {
      assert.equal((await api(server.url, "/api/tokens")).body[0].trendingRank, null);
    }
  } finally {
    await server.close();
    fs.rmSync(dbPath, { force: true });
  }
});
