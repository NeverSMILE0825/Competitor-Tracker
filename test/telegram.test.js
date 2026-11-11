import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { TELEGRAM_TEST_TEXT, chatIdFromUpdates, telegramText } from "../src/core/telegram.js";
import { openDatabase } from "../src/db.js";
import { startServer } from "../src/server.js";
import { createTelegramNotifier } from "../src/telegram.js";

const TOKEN = "123456789:AAEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const CHAT = "424242";

function sample(id, title, body) {
  return {
    id,
    kind: "contract_started",
    chain: "ethereum",
    tokenAddress: `0x${"ab".repeat(20)}`,
    competitorId: 1,
    title,
    body,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("telegram text is the alert title and body", () => {
  assert.equal(
    telegramText({ title: "Contract started · DACITY", body: "0xcreator funded by 0xfunder (Binance 153)" }),
    "Contract started · DACITY\n0xcreator funded by 0xfunder (Binance 153)",
  );
});

test("chat lookup uses the latest numeric chat id", () => {
  assert.equal(chatIdFromUpdates({
    result: [
      { message: { chat: { id: 11 } } },
      { channel_post: { chat: { id: -22 } } },
    ],
  }), "-22");
  assert.equal(chatIdFromUpdates({ result: [] }), null);
});

test("telegram sends only alerts created after it is enabled, and only once", async () => {
  const db = openDatabase(":memory:");
  const sent = [];
  const notifier = createTelegramNotifier({
    db,
    async call(token, method, payload) {
      sent.push({ token, method, payload });
      return { ok: true, result: { message_id: sent.length } };
    },
  });
  db.insertAlerts([sample("old", "Contract started · OLD", "before")]);
  await wait(5);
  notifier.save({ token: TOKEN, chatId: CHAT });
  await wait(5);
  db.insertAlerts([sample("new", "DexScreener paid · DACITY", "approved token info · ban clear")]);
  const first = await notifier.flush();
  assert.equal(first.sent, 1);
  const message = sent.find((item) => item.method === "sendMessage");
  assert.equal(message.payload.text, "DexScreener paid · DACITY\napproved token info · ban clear");
  assert.equal(message.payload.chat_id, CHAT);
  db.markDelivered(["new"]);
  assert.equal(db.pendingAlerts().some((alert) => alert.id === "new"), false);
  assert.equal(db.pendingAlerts().some((alert) => alert.id === "old"), true);
  assert.equal((await notifier.flush()).sent, 0);
  assert.equal(sent.filter((item) => item.method === "sendMessage").length, 1);
  db.close();
});

test("a rejected Telegram send stays unsent and hides the bot token", async () => {
  const db = openDatabase(":memory:");
  const notifier = createTelegramNotifier({
    db,
    async call(token) {
      return { ok: false, description: `Unauthorized ${token}`, retry: false };
    },
  });
  notifier.save({ token: TOKEN, chatId: CHAT });
  await wait(5);
  db.insertAlerts([sample("fail", "Rugged · DACITY", "quote removed · 0xabc")]);
  const result = await notifier.flush();
  assert.equal(result.sent, 0);
  assert.equal(db.pendingTelegram(0).length, 1);
  assert.equal(result.lastError.includes(TOKEN), false);
  assert.match(result.lastError, /Unauthorized \[token\]/);
  db.close();
});

test("an environment bot does not replay alerts already stored", async () => {
  const db = openDatabase(":memory:");
  db.insertAlerts([sample("old", "Contract started · OLD", "before")]);
  await wait(5);
  const sent = [];
  const notifier = createTelegramNotifier({
    db,
    envToken: TOKEN,
    envChatId: CHAT,
    async call() {
      sent.push("sent");
      return { ok: true, result: { message_id: 1 } };
    },
  });
  notifier.start();
  await notifier.flush();
  db.insertAlerts([sample("new", "Ban status · DACITY", "clear → banned")]);
  await notifier.flush();
  assert.equal(sent.length, 1);
  notifier.stop();
  db.close();
});

test("an older database gains the telegram column", () => {
  const file = path.join(os.tmpdir(), `tracker-old-${Date.now()}.db`);
  const raw = new DatabaseSync(file);
  raw.exec(`
    CREATE TABLE alerts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      chain TEXT NOT NULL,
      token_address TEXT,
      competitor_id INTEGER,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0
    )
  `);
  raw.close();
  const db = openDatabase(file);
  const created = db.insertAlerts([sample("migrated", "Contract started · DACITY", "after upgrade")]);
  assert.equal(created.length, 1);
  assert.equal(db.pendingTelegram(0).length, 1);
  db.close();
  fs.rmSync(file, { force: true });
});

test("telegram routes never return the bot token", async () => {
  const calls = [];
  const server = await startServer({
    dbPath: ":memory:",
    port: 0,
    watch: false,
    async telegramCall(token, method, payload) {
      calls.push({ token, method, payload });
      if (method === "getMe") return { ok: true, result: { username: "tracker_bot" } };
      if (method === "getUpdates") return { ok: true, result: [{ message: { chat: { id: 77 } } }] };
      if (method === "sendMessage") return { ok: true, result: { message_id: 1 } };
      return { ok: false, description: `bad ${token}`, retry: false };
    },
  });
  try {
    const bad = await fetch(`${server.url}/api/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "nope", chatId: "1" }),
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "Telegram bot token is invalid");

    const discovered = await fetch(`${server.url}/api/telegram/discover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN }),
    });
    const discoveredBody = await discovered.json();
    assert.equal(discovered.status, 200, JSON.stringify(discoveredBody));
    assert.equal(discoveredBody.chatId, "77");
    assert.equal(JSON.stringify(discoveredBody).includes(TOKEN), false);

    const saved = await fetch(`${server.url}/api/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN, chatId: discoveredBody.chatId }),
    });
    const savedBody = await saved.json();
    assert.equal(saved.status, 200, JSON.stringify(savedBody));
    assert.equal(savedBody.enabled, true);
    assert.equal(savedBody.chatId, "77");
    assert.equal(Object.hasOwn(savedBody, "token"), false);

    const tested = await fetch(`${server.url}/api/telegram/test`, { method: "POST" });
    assert.equal(tested.status, 200);
    assert.equal(calls.at(-1).method, "sendMessage");
    assert.equal(calls.at(-1).payload.text, TELEGRAM_TEST_TEXT);

    const health = await (await fetch(`${server.url}/api/health`)).json();
    assert.equal(JSON.stringify(health).includes(TOKEN), false);

    assert.equal((await (await fetch(`${server.url}/api/telegram`, { method: "DELETE" })).json()).enabled, false);
    const quiet = await fetch(`${server.url}/api/telegram/test`, { method: "POST" });
    assert.equal(quiet.status, 400);
  } finally {
    await server.close();
  }
});
