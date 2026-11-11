const TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;
const CHAT = /^-?\d{1,20}$/;

export const TELEGRAM_TEST_TEXT = "Competitor tracker test. This is not a token alert. New contract, Dex paid, rug, and ban alerts will arrive in this chat.";

export function assertTelegramToken(token) {
  const cleanToken = String(token ?? "").trim();
  if (!TOKEN.test(cleanToken)) {
    const error = new Error("Telegram bot token is invalid");
    error.status = 400;
    throw error;
  }
  return cleanToken;
}

export function assertTelegramConfig(token, chatId) {
  const cleanToken = assertTelegramToken(token);
  const cleanChat = String(chatId ?? "").trim();
  if (!CHAT.test(cleanChat)) {
    const error = new Error("Telegram chat id must be the numeric id");
    error.status = 400;
    throw error;
  }
  return { token: cleanToken, chatId: cleanChat };
}

export function redactSecret(text, secret) {
  const value = String(text ?? "");
  if (!secret) return value;
  return value.split(secret).join("[token]");
}

export function telegramText(alert) {
  const text = `${alert.title}\n${alert.body}`;
  return text.length <= 4096 ? text : text.slice(0, 4096);
}

export function chatIdFromUpdates(body) {
  const updates = Array.isArray(body?.result) ? body.result : [];
  let chatId = null;
  for (const update of updates) {
    const chat = update?.message?.chat ?? update?.edited_message?.chat ?? update?.channel_post?.chat ?? null;
    if (chat && Number.isInteger(chat.id)) chatId = String(chat.id);
  }
  return chatId;
}
