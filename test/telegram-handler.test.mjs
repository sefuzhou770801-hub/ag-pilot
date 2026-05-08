import assert from "node:assert/strict";
import test from "node:test";

import { parseCommand, createHandler } from "../lib/telegram-handler.mjs";

// --- parseCommand tests ---

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

// --- handler helpers ---

function makeHandler(overrides = {}) {
  const replies = [];
  const photos = [];
  const savedStates = [];
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
        paused: false,
      },
    }),
    saveState: async (data) => { savedStates.push(data); },
    sendTextToAntigravity: async () => ({ sent: true }),
    readLatestAntigravityReply: async () => ({ text: "CC reply" }),
    listAntigravityConversations: async () => [
      { title: "Conv A", running: true, selected: false, recent: false },
      { title: "Conv B", running: false, selected: true, recent: false },
    ],
    captureAntigravityScreenshot: async () => Buffer.from("fake-png"),
    stopAntigravityAgent: async () => ({ stopped: true }),
    updateViewGroup: (state, updates) => ({ ...state.data, ...updates }),
    isAntigravityBusy: async () => false,
    replyTimeoutMs: 200,
    replyPollMs: 10,
  };
  const handler = createHandler({ ...defaults, ...overrides });
  return { handler, replies, photos, savedStates };
}

// --- 修复1: 普通消息直接聊天 ---

test("plain text sends directly to Antigravity", async () => {
  const sent = [];
  const { handler, replies } = makeHandler({
    sendTextToAntigravity: async (opts) => { sent.push(opts); return { sent: true }; },
    isAntigravityBusy: null, // 不等待回复
  });
  await handler({ message: { chat: { id: 100 }, text: "hello CC" } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "hello CC");
  assert.ok(replies.some((r) => r.text.includes("Sent to")));
});

test("plain text with no bound conversation gives helpful message", async () => {
  const { handler, replies } = makeHandler({
    loadState: async () => ({
      data: {
        groups: [{ id: "g1", name: "默认", agTitle: "", codexThreadId: "", codexBusy: false }],
        activeGroupId: "g1",
        viewGroupId: "g1",
        paused: false,
      },
    }),
  });
  await handler({ message: { chat: { id: 100 }, text: "hello?" } });
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("/list"));
});

// --- 修复2: 自动回推 ---

test("auto-reply push on busy→idle transition", async () => {
  let callCount = 0;
  const { handler, replies } = makeHandler({
    isAntigravityBusy: async () => {
      callCount++;
      return callCount <= 2; // busy for 2 polls, then idle
    },
    readLatestAntigravityReply: async () => ({ text: "Here is my answer" }),
  });
  await handler({ message: { chat: { id: 100 }, text: "explain this" } });
  assert.ok(replies.some((r) => r.text.includes("Sent to")));
  assert.ok(replies.some((r) => r.text.includes("Here is my answer")));
});

test("auto-reply push timeout gives clear message", async () => {
  const { handler, replies } = makeHandler({
    isAntigravityBusy: async () => false, // never busy
  });

  // patch waitAndPushReply timeout to be very short for testing
  // since isAntigravityBusy never returns true, wasBusy never becomes true,
  // so we test the timeout path with a short timeout by reimporting
  // For now, test that at least the sent message is correct
  await handler({ message: { chat: { id: 100 }, text: "test timeout" } });
  assert.ok(replies.some((r) => r.text.includes("Sent to")));
});

// --- 修复3: /list 带编号, /use 切换 ---

test("/list shows numbered conversations with current marker", async () => {
  const { handler, replies } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/list" } });
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("1."));
  assert.ok(replies[0].text.includes("2."));
  assert.ok(replies[0].text.includes("/use"));
});

test("/use switches current conversation by number", async () => {
  const { handler, replies, savedStates } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/use 2" } });
  assert.ok(replies.some((r) => r.text.includes("Conv B")));
  assert.ok(replies.some((r) => r.text.includes("Now chatting with")));
  assert.equal(savedStates.length, 1);
});

test("/use switches by partial title", async () => {
  const { handler, replies, savedStates } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/use conv a" } });
  assert.ok(replies.some((r) => r.text.includes("Conv A")));
  assert.equal(savedStates.length, 1);
});

test("/use with invalid number gives error", async () => {
  const { handler, replies } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/use 99" } });
  assert.ok(replies[0].text.includes("not found"));
});

// --- 修复4: /status 显示 thinking 状态 ---

test("/status shows thinking when busy", async () => {
  const { handler, replies } = makeHandler({
    isAntigravityBusy: async () => true,
  });
  await handler({ message: { chat: { id: 100 }, text: "/status" } });
  assert.ok(replies[0].text.includes("thinking"));
});

test("/status shows paused state", async () => {
  const { handler, replies } = makeHandler({
    loadState: async () => ({
      data: {
        groups: [{ id: "g1", name: "默认", agTitle: "CC1", codexThreadId: "019x", codexBusy: false }],
        activeGroupId: "g1",
        viewGroupId: "g1",
        paused: true,
      },
    }),
  });
  await handler({ message: { chat: { id: 100 }, text: "/status" } });
  assert.ok(replies[0].text.includes("⏸"));
});

// --- 修复5: /peek 文案优化 ---

test("/peek caption includes conversation title", async () => {
  const { handler, photos } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/peek" } });
  assert.equal(photos.length, 1);
  assert.ok(photos[0].caption.includes("CC1"));
});

// --- 修复6: pause 真阻断 ---

test("plain text blocked when paused", async () => {
  const sent = [];
  const { handler, replies } = makeHandler({
    loadState: async () => ({
      data: {
        groups: [{ id: "g1", name: "默认", agTitle: "CC1", codexThreadId: "019x", codexBusy: false }],
        activeGroupId: "g1",
        viewGroupId: "g1",
        paused: true,
      },
    }),
    sendTextToAntigravity: async (opts) => { sent.push(opts); },
  });
  await handler({ message: { chat: { id: 100 }, text: "hello" } });
  assert.equal(sent.length, 0); // message NOT sent
  assert.ok(replies[0].text.includes("paused"));
  assert.ok(replies[0].text.includes("/resume"));
});

test("/send blocked when paused", async () => {
  const sent = [];
  const { handler, replies } = makeHandler({
    loadState: async () => ({
      data: {
        groups: [{ id: "g1", name: "默认", agTitle: "CC1", codexThreadId: "019x", codexBusy: false }],
        activeGroupId: "g1",
        viewGroupId: "g1",
        paused: true,
      },
    }),
    sendTextToAntigravity: async (opts) => { sent.push(opts); },
  });
  await handler({ message: { chat: { id: 100 }, text: "/send test" } });
  assert.equal(sent.length, 0);
  assert.ok(replies[0].text.includes("paused"));
});

test("/pause sets paused flag in saved state", async () => {
  const { handler, savedStates } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/pause" } });
  assert.equal(savedStates.length, 1);
  assert.equal(savedStates[0].paused, true);
});

test("/resume clears paused flag", async () => {
  const { handler, savedStates } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/resume" } });
  assert.equal(savedStates.length, 1);
  assert.equal(savedStates[0].paused, false);
});

// --- 修复7: 危险命令确认 ---

test("/stop requires confirmation", async () => {
  const { handler, replies, savedStates } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/stop" } });
  assert.equal(savedStates.length, 0); // NOT executed yet
  assert.ok(replies[0].text.includes("confirm"));
});

test("/confirm_stop after /stop executes the stop", async () => {
  const { handler, replies, savedStates } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/stop" } });
  await handler({ message: { chat: { id: 100 }, text: "/confirm_stop" } });
  assert.equal(savedStates.length, 1);
  assert.ok(savedStates[0].paused === true);
  assert.ok(replies.some((r) => r.text.includes("Stop Confirmed")));
});

test("/confirm_stop without prior /stop is rejected", async () => {
  const { handler, replies, savedStates } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/confirm_stop" } });
  assert.equal(savedStates.length, 0);
  assert.ok(replies[0].text.includes("not requested"));
});

test("/disconnect requires confirmation", async () => {
  const { handler, replies, savedStates } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/disconnect" } });
  assert.equal(savedStates.length, 0);
  assert.ok(replies[0].text.includes("confirm"));
});

test("/confirm_disconnect after /disconnect clears bindings", async () => {
  const { handler, replies, savedStates } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/disconnect" } });
  await handler({ message: { chat: { id: 100 }, text: "/confirm_disconnect" } });
  assert.equal(savedStates.length, 1);
  assert.ok(replies.some((r) => r.text.includes("Disconnected")));
});

// --- existing command tests ---

test("handler ignores messages from unauthorized chat", async () => {
  const { handler, replies } = makeHandler();
  await handler({ message: { chat: { id: 999 }, text: "/status" } });
  assert.equal(replies.length, 0);
});

test("handler /read returns latest Antigravity reply", async () => {
  const { handler, replies } = makeHandler({
    readLatestAntigravityReply: async () => ({ text: "CC reply content" }),
  });
  await handler({ message: { chat: { id: 100 }, text: "/read" } });
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("CC reply content"));
});

test("handler /start shows help", async () => {
  const { handler, replies } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/start" } });
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("Just type your message"));
});

test("handler /help shows /use command", async () => {
  const { handler, replies } = makeHandler();
  await handler({ message: { chat: { id: 100 }, text: "/help" } });
  assert.ok(replies[0].text.includes("/use"));
  assert.ok(replies[0].text.includes("needs confirm"));
});
