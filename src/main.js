import { startServer } from "./server.js";

const server = await startServer({
  telegramEnv: {
    token: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
  },
});
console.log(`Competitor tracker listening at ${server.url}`);
