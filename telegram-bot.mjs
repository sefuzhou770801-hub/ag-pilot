#!/usr/bin/env node
import { TelegramClient, startPolling } from "./lib/telegram.mjs";
import { createHandler } from "./lib/telegram-handler.mjs";
import {
  captureAntigravityScreenshot,
  getAntigravityStatus,
  listAntigravityConversations,
  readLatestAntigravityReply,
  sendTextToAntigravity,
  stopAntigravityAgent,
} from "./lib/antigravity-client.mjs";
import { loadState, saveState, updateViewGroup } from "./lib/config.mjs";

const token = process.env.AG_TELEGRAM_TOKEN;
if (!token) {
  console.error("AG_TELEGRAM_TOKEN is not set.");
  console.error("Usage: AG_TELEGRAM_TOKEN=<token> AG_TELEGRAM_CHAT_ID=<id> node telegram-bot.mjs");
  process.exit(1);
}

const chatIdRaw = process.env.AG_TELEGRAM_CHAT_ID;
if (!chatIdRaw) {
  console.error("AG_TELEGRAM_CHAT_ID is not set. Use @userinfobot on Telegram to get your chat ID.");
  process.exit(1);
}

const allowedChatIds = chatIdRaw.split(",").map((s) => Number(s.trim())).filter(Number.isFinite);

const client = new TelegramClient(token);
const handler = createHandler({
  allowedChatIds,
  sendReply: (chatId, text) => client.sendMessage(chatId, text),
  sendPhoto: (chatId, buffer, caption) => client.sendPhoto(chatId, buffer, caption),
  getAntigravityStatus,
  loadState,
  saveState,
  sendTextToAntigravity,
  readLatestAntigravityReply,
  listAntigravityConversations,
  captureAntigravityScreenshot,
  stopAntigravityAgent,
  updateViewGroup,
});

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());

console.log(`AG Pilot Telegram Bot started. Allowed chat IDs: [${allowedChatIds.join(", ")}]`);
const { done } = startPolling(client, handler, { signal: controller.signal });
await done;
console.log("Bot stopped.");
