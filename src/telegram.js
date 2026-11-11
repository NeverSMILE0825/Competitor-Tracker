import { TELEGRAM_TEST_TEXT, chatIdFromUpdates, redactSecret, telegramText } from "./core/telegram.js";

export function createTelegramNotifier(options) {
  const db = options.db;
  const call = options.call;
  let lastError = null;
  let holdUntil = 0;
  let sending = false;
  let timer = null;

  function storedConfig() {
    const savedToken = db.getSetting("telegram_token");
    const savedChat = db.getSetting("telegram_chat_id");
    if (savedToken && savedChat) return { token: savedToken, chatId: savedChat };
    const envToken = String(options.envToken ?? "").trim();
    const envChat = String(options.envChatId ?? "").trim();
    if (envToken && envChat) return { token: envToken, chatId: envChat };
    return null;
  }

  function resolve() {
    if (db.getSetting("telegram_disabled") === "1") return null;
    return storedConfig();
  }

  function status() {
    const active = resolve();
    const stored = storedConfig();
    return {
      enabled: Boolean(active),
      saved: Boolean(stored),
      chatId: (active ?? stored)?.chatId ?? null,
      lastError,
    };
  }

  function save(config) {
    const enabling = db.getSetting("telegram_disabled") === "1" || db.getSetting("telegram_enabled_at") == null;
    db.setSetting("telegram_token", config.token);
    db.setSetting("telegram_chat_id", config.chatId);
    db.deleteSetting("telegram_disabled");
    if (enabling) db.setSetting("telegram_enabled_at", String(Date.now()));
    lastError = null;
    holdUntil = 0;
    return status();
  }

  function disable() {
    db.setSetting("telegram_disabled", "1");
    db.deleteSetting("telegram_enabled_at");
    lastError = null;
    holdUntil = 0;
    return status();
  }

  function enable() {
    if (!storedConfig()) {
      const error = new Error("Save the bot token and chat id first");
      error.status = 400;
      throw error;
    }
    const wasOff = db.getSetting("telegram_disabled") === "1" || db.getSetting("telegram_enabled_at") == null;
    db.deleteSetting("telegram_disabled");
    if (wasOff) db.setSetting("telegram_enabled_at", String(Date.now()));
    lastError = null;
    holdUntil = 0;
    return status();
  }

  async function check(token) {
    const result = await call(token, "getMe", {});
    return { ...result, description: redactSecret(result.description, token) };
  }

  async function discover(token) {
    const me = await check(token);
    if (!me.ok) return { ok: false, description: me.description };
    const updates = await call(token, "getUpdates", { timeout: 0, allowed_updates: ["message", "channel_post"] });
    if (!updates.ok) return { ok: false, description: redactSecret(updates.description, token) };
    const chatId = chatIdFromUpdates({ result: updates.result });
    if (!chatId) return { ok: false, description: "Message the bot once, then look up the chat id again" };
    return { ok: true, chatId };
  }

  async function sendTest() {
    const config = resolve();
    if (!config) {
      const error = new Error("Save the Telegram bot before sending a test");
      error.status = 400;
      throw error;
    }
    const result = await call(config.token, "sendMessage", {
      chat_id: config.chatId,
      text: TELEGRAM_TEST_TEXT,
      disable_web_page_preview: true,
    });
    if (!result.ok) {
      lastError = redactSecret(result.description, config.token);
      const error = new Error(lastError);
      error.status = 400;
      throw error;
    }
    lastError = null;
    return { ok: true };
  }

  async function flush() {
    if (sending || Date.now() < holdUntil) return { sent: 0, lastError };
    const config = resolve();
    const rawSince = db.getSetting("telegram_enabled_at");
    const since = rawSince == null ? null : Number(rawSince);
    if (!config || !Number.isInteger(since)) return { sent: 0, lastError };
    sending = true;
    let sent = 0;
    try {
      for (const alert of db.pendingTelegram(since)) {
        let result;
        try {
          result = await call(config.token, "sendMessage", {
            chat_id: config.chatId,
            text: telegramText(alert),
            disable_web_page_preview: true,
          });
        } catch (error) {
          lastError = redactSecret(error.message, config.token);
          holdUntil = Date.now() + 15000;
          break;
        }
        if (!result.ok) {
          lastError = redactSecret(result.description, config.token);
          holdUntil = Date.now() + (result.retry ? 15000 : 60000);
          break;
        }
        db.markTelegramSent(alert.id);
        lastError = null;
        holdUntil = 0;
        sent += 1;
      }
    } finally {
      sending = false;
    }
    return { sent, lastError };
  }

  return {
    status,
    save,
    disable,
    enable,
    check,
    discover,
    sendTest,
    flush,
    token() {
      return storedConfig()?.token ?? null;
    },
    start() {
      if (timer) return;
      if (resolve() && db.getSetting("telegram_enabled_at") == null) {
        db.setSetting("telegram_enabled_at", String(Date.now()));
      }
      timer = setInterval(() => { flush().catch(() => {}); }, options.intervalMs ?? 5000);
      timer.unref?.();
      flush().catch(() => {});
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
