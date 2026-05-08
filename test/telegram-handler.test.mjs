import assert from "node:assert/strict";
import test from "node:test";

import { parseCommand, createHandler } from "../lib/telegram-handler.mjs";

test("parseCommand extracts command and args from /send hello world", () => {
  const result = parseCommand("/send hello world");
  assert.equal(result.command, "send");
  assert.equal(result.args, "hello world");
});

test("parseCommand handles /status with no args", () => {
  const result = parseCommand("/status");
  assert.equal(result.command, "status");
  assert.equal(result.args, "");
});

test("parseCommand strips @BotName suffix", () => {
  const result = parseCommand("/status@MyBot");
  assert.equal(result.command, "status");
});

test("parseCommand returns null for non-command text", () => {
  assert.equal(parseCommand("just some text"), null);
});

function makeHandler(overrides = {}) {
  const replies = [];
  const photos = [];
  const defaults = {
    allowedChatIds: [100],
    sendReply: async (chatId, text) => replies.push({ chatId, text }),
    sendPhoto: async (chatId, buf, caption) => photos.push({ chatId, buf, caption }),
    getAntigravityStatus: async () => ({ cdp: { connected: true, port: 9333 } }),
    loadState: async () => ({
      data: {
        groups: [{ id: "g1", name: "默认", agTitle: "CC1", codexThreadId: "019x", codexBusy: false }],
        activeGroupId: "g1",
        viewGroupId: "g1",
      },
    }),
    saveState: async () => {},
    sendTextToAntigravity: async () => ({ sent: true }),
    readLatestAntigravityReply: async () => ({ text: "CC reply" }),
    listAntigravityConversations: async () => [
      { title: "Conv A", running: true, selected: false, recent: false },
      { title: "Conv B", running: false, selected: true, recent: false },
    ],
    captureAntigravityScreenshot: async () => Buffer.from("fake-png"),
    stopAntigravityAgent: async () => ({ stopped: true }),
    updateViewGroup: (state, updates) => ({ ...state.data, ...updates }),
  };
  const handler = createHandler({ ...defaults, ...overrides });
  return { handler, replies, photos };
}

test("handler /status calls getAntigravityStatus and replies", async () => {
  const { handler, replies } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/status" } });
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("CDP"));
});

test("handler ignores messages from unauthorized chat", async () => {
  const { handler, replies } = makeHandler();
  await handler({ message: { chat: { id: 999 }, text: "/status" } });
  assert.equal(replies.length, 0);
});

test("handler /send forwards text to Antigravity via AG Pilot", async () => {
  const sent = [];
  const { handler, replies } = makeHandler({
    sendTextToAntigravity: async (options) => { sent.push(options); return { sent: true }; },
  });
  await handler({ message: { chat: { id: 100 }, text: "/send test message" } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "test message");
  assert.equal(replies.length, 1);
});

test("handler /read returns latest Antigravity reply", async () => {
  const { handler, replies } = makeHandler({
    readLatestAntigravityReply: async () => ({ text: "CC reply content" }),
  });
  await handler({ message: { chat: { id: 100 }, text: "/read" } });
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("CC reply content"));
});

test("handler /list shows active conversations", async () => {
  const { handler, replies } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/list" } });
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("Conv A"));
  assert.ok(replies[0].text.includes("Conv B"));
  assert.ok(replies[0].text.includes("🔴"));
});

test("handler /peek sends a screenshot photo", async () => {
  const { handler, replies, photos } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/peek" } });
  assert.equal(replies.length, 1); // "Capturing screenshot..." message
  assert.equal(photos.length, 1);
  assert.equal(photos[0].chatId, 100);
});

test("handler /pause sets paused flag", async () => {
  let savedData = null;
  const { handler, replies } = makeHandler({
    saveState: async (data) => { savedData = data; },
  });
  await handler({ message: { chat: { id: 100 }, text: "/pause" } });
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("⏸"));
  assert.equal(savedData.paused, true);
});

test("handler /resume clears paused flag", async () => {
  let savedData = null;
  const { handler, replies } = makeHandler({
    saveState: async (data) => { savedData = data; },
  });
  await handler({ message: { chat: { id: 100 }, text: "/resume" } });
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("▶️"));
  assert.equal(savedData.paused, false);
});

test("handler /stop clicks stop and clears busy states", async () => {
  let savedData = null;
  const { handler, replies } = makeHandler({
    saveState: async (data) => { savedData = data; },
  });
  await handler({ message: { chat: { id: 100 }, text: "/stop" } });
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("🛑"));
  assert.ok(savedData.groups.every((g) => g.codexBusy === false));
  assert.equal(savedData.paused, true);
});

test("handler /disconnect clears current group bindings", async () => {
  let savedData = null;
  const { handler, replies } = makeHandler({
    saveState: async (data) => { savedData = data; },
    updateViewGroup: (state, updates) => ({ ...state.data, ...updates }),
  });
  await handler({ message: { chat: { id: 100 }, text: "/disconnect" } });
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("🔌"));
});

test("handler /start shows help", async () => {
  const { handler, replies } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/start" } });
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("/status"));
  assert.ok(replies[0].text.includes("/peek"));
  assert.ok(replies[0].text.includes("/stop"));
});
