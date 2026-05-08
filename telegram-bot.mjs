#!/usr/bin/env node
import { TelegramClient, startPolling } from "./lib/telegram.mjs";
import { createHandler } from "./lib/telegram-handler.mjs";
import {
  captureAntigravityScreenshot,
  getAntigravityStatus,
  isAntigravityTargetBusy,
  listAntigravityConversations,
  readLatestAntigravityReply,
  sendTextToAntigravity,
  stopAntigravityAgent,
} from "./lib/antigravity-client.mjs";
import { getViewGroup, loadState, saveState, updateViewGroup } from "./lib/config.mjs";

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
  isAntigravityBusy: isAntigravityTargetBusy,
});

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());

// CC 回复自动推送：检测 busy→idle 转变时自动发送最新回复到 Telegram
const WATCH_INTERVAL_MS = 5000;
let lastBusy = false;

async function replyWatcher() {
  while (!controller.signal.aborted) {
    try {
      const busy = await isAntigravityTargetBusy().catch(() => false);
      if (lastBusy && !busy) {
        // busy → idle：CC 刚回复完
        const state = await loadState();
        const group = getViewGroup(state);
        if (group?.agTitle) {
          const reply = await readLatestAntigravityReply({ title: group.agTitle }).catch(() => null);
          if (reply?.text) {
            const truncated = reply.text.length > 4000
              ? reply.text.slice(0, 4000) + "\n\n...(truncated)"
              : reply.text;
            for (const chatId of allowedChatIds) {
              await client.sendMessage(chatId, `💬 *CC replied:*\n\n${truncated}`).catch((err) => {
                console.error("Auto-push failed:", err.message);
              });
            }
          }
        }
      }
      lastBusy = busy;
    } catch (err) {
      // CDP 不可用时静默跳过
    }
    await new Promise((r) => setTimeout(r, WATCH_INTERVAL_MS));
  }
}

console.log(`AG Pilot Telegram Bot started. Allowed chat IDs: [${allowedChatIds.join(", ")}]`);
console.log(`Reply watcher: checking every ${WATCH_INTERVAL_MS / 1000}s for CC responses.`);
const { done } = startPolling(client, handler, { signal: controller.signal });
replyWatcher();
await done;
console.log("Bot stopped.");

