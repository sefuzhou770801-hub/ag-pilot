# Telegram Bridge 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户通过 Telegram Bot 远程控制 AG Pilot——发消息给 CC、读 CC 回复、查看状态、切换分组。

**Architecture:** 新增一个 `telegram-bot.mjs` 入口和 `lib/telegram.mjs` 模块。Bot 通过 long-polling 接收 Telegram 消息，调用已有的 `antigravity-client.mjs`、`config.mjs` 等模块执行操作，结果回传 Telegram。零外部依赖——用 Node 22 原生 fetch 调 Telegram Bot API。

**Tech Stack:** Node.js 22（ESM），node:test，原生 fetch，Telegram Bot API（HTTP long-polling）

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `lib/telegram.mjs` | Telegram Bot API 封装：sendMessage、getUpdates、long-polling 循环 |
| `lib/telegram-handler.mjs` | 命令解析与路由：把 `/status`、`/send` 等命令映射到已有的 bridge 操作 |
| `telegram-bot.mjs` | 入口文件：读取 token、启动 polling 循环 |
| `test/telegram.test.mjs` | telegram.mjs 的单元测试 |
| `test/telegram-handler.test.mjs` | telegram-handler.mjs 的单元测试 |
| `scripts/install-telegram-service.sh` | 注册 macOS LaunchAgent 让 Bot 后台运行 |

---

## Task 1: Telegram Bot API 封装

**Files:**
- Create: `lib/telegram.mjs`
- Test: `test/telegram.test.mjs`

- [ ] **Step 1: 写 telegram.mjs 的失败测试**

```javascript
// test/telegram.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { TelegramClient } from "../lib/telegram.mjs";

test("sendMessage calls Telegram API with correct payload", async () => {
  const requests = [];
  const client = new TelegramClient("test-token", {
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true, result: {} }) };
    },
  });

  await client.sendMessage(123, "hello");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.telegram.org/bottest-token/sendMessage");
  assert.deepEqual(requests[0].body, { chat_id: 123, text: "hello", parse_mode: "Markdown" });
});

test("getUpdates passes offset and timeout", async () => {
  const requests = [];
  const client = new TelegramClient("test-token", {
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true, result: [] }) };
    },
  });

  await client.getUpdates(42, 30);
  assert.equal(requests[0].body.offset, 42);
  assert.equal(requests[0].body.timeout, 30);
});

test("sendMessage throws on API error", async () => {
  const client = new TelegramClient("bad-token", {
    fetch: async () => ({
      ok: true,
      json: async () => ({ ok: false, description: "Unauthorized" }),
    }),
  });

  await assert.rejects(() => client.sendMessage(1, "x"), /Unauthorized/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/telegram.test.mjs`
Expected: FAIL — `TelegramClient` 不存在

- [ ] **Step 3: 实现 telegram.mjs**

```javascript
// lib/telegram.mjs
const BASE = "https://api.telegram.org/bot";

export class TelegramClient {
  constructor(token, options = {}) {
    if (!token) throw new Error("Telegram bot token is required");
    this.token = token;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async sendMessage(chatId, text, options = {}) {
    return await this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode ?? "Markdown",
    });
  }

  async getUpdates(offset = 0, timeout = 30) {
    return await this.call("getUpdates", {
      offset,
      timeout,
      allowed_updates: ["message"],
    });
  }

  async call(method, body) {
    const url = `${BASE}${this.token}/${method}`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!data.ok) throw new Error(`Telegram API ${method}: ${data.description ?? "unknown error"}`);
    return data.result;
  }
}

export function startPolling(client, handler, options = {}) {
  const signal = options.signal;
  let offset = 0;
  let running = true;

  if (signal) signal.addEventListener("abort", () => { running = false; });

  const loop = async () => {
    while (running) {
      try {
        const updates = await client.getUpdates(offset, 30);
        for (const update of updates) {
          offset = update.update_id + 1;
          try {
            await handler(update);
          } catch (err) {
            console.error("Handler error:", err.message);
          }
        }
      } catch (err) {
        if (!running) break;
        console.error("Polling error:", err.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };

  const promise = loop();
  return { stop: () => { running = false; }, done: promise };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/telegram.test.mjs`
Expected: 3 tests PASS

- [ ] **Step 5: 提交**

```bash
git add lib/telegram.mjs test/telegram.test.mjs
git commit -m "feat: add Telegram Bot API client with long-polling"
```

---

## Task 2: 命令处理器

**Files:**
- Create: `lib/telegram-handler.mjs`
- Test: `test/telegram-handler.test.mjs`

- [ ] **Step 1: 写命令处理器的失败测试**

```javascript
// test/telegram-handler.test.mjs
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

test("handler /status calls getAntigravityStatus and replies", async () => {
  const replies = [];
  const handler = createHandler({
    allowedChatIds: [100],
    sendReply: async (chatId, text) => replies.push({ chatId, text }),
    getAntigravityStatus: async () => ({ cdp: { connected: true, port: 9333 } }),
    loadState: async () => ({ data: { groups: [{ id: "g1", name: "默认", ccTitle: "CC1", codexThreadId: "019x", codexBusy: false }], activeGroupId: "g1", viewGroupId: "g1" } }),
  });

  await handler({ message: { chat: { id: 100 }, text: "/status" } });
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("CDP"));
});

test("handler ignores messages from unauthorized chat", async () => {
  const replies = [];
  const handler = createHandler({
    allowedChatIds: [100],
    sendReply: async (chatId, text) => replies.push({ chatId, text }),
  });

  await handler({ message: { chat: { id: 999 }, text: "/status" } });
  assert.equal(replies.length, 0);
});

test("handler /send forwards text to CC via AG Pilot", async () => {
  const sent = [];
  const replies = [];
  const handler = createHandler({
    allowedChatIds: [100],
    sendReply: async (chatId, text) => replies.push({ chatId, text }),
    sendTextToAntigravity: async (options) => { sent.push(options); return { sent: true }; },
    loadState: async () => ({ data: { groups: [{ id: "g1", name: "默认", ccTitle: "Bound CC", codexThreadId: "", codexBusy: false }], activeGroupId: "g1", viewGroupId: "g1" } }),
  });

  await handler({ message: { chat: { id: 100 }, text: "/send 帮我看看这个文件" } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "帮我看看这个文件");
  assert.equal(sent[0].title, "Bound CC");
  assert.equal(replies.length, 1);
});

test("handler /read returns latest CC reply", async () => {
  const replies = [];
  const handler = createHandler({
    allowedChatIds: [100],
    sendReply: async (chatId, text) => replies.push({ chatId, text }),
    readLatestAntigravityReply: async () => ({ text: "CC 的回复内容" }),
    loadState: async () => ({ data: { groups: [{ id: "g1", name: "默认", ccTitle: "Bound CC", codexThreadId: "", codexBusy: false }], activeGroupId: "g1", viewGroupId: "g1" } }),
  });

  await handler({ message: { chat: { id: 100 }, text: "/read" } });
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.includes("CC 的回复内容"));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/telegram-handler.test.mjs`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 telegram-handler.mjs**

```javascript
// lib/telegram-handler.mjs
import { getViewGroup } from "./config.mjs";

export function parseCommand(text) {
  if (!text || !text.startsWith("/")) return null;
  const match = text.match(/^\/(\w+)(?:@\S+)?\s*(.*)/s);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: match[2].trim() };
}

export function createHandler(dependencies) {
  const {
    allowedChatIds,
    sendReply,
    getAntigravityStatus,
    loadState,
    sendTextToAntigravity,
    readLatestAntigravityReply,
  } = dependencies;

  const allowed = new Set(allowedChatIds);

  return async function handle(update) {
    const message = update?.message;
    if (!message?.chat?.id || !message?.text) return;
    const chatId = message.chat.id;
    if (!allowed.has(chatId)) return;

    const parsed = parseCommand(message.text);
    if (!parsed) return;

    try {
      switch (parsed.command) {
        case "status":
          return await cmdStatus(chatId);
        case "send":
          return await cmdSend(chatId, parsed.args);
        case "read":
          return await cmdRead(chatId);
        case "help":
          return await cmdHelp(chatId);
        default:
          return await sendReply(chatId, `未知命令: /${parsed.command}\n输入 /help 查看可用命令`);
      }
    } catch (err) {
      await sendReply(chatId, `错误: ${err.message}`);
    }
  };

  async function cmdStatus(chatId) {
    const status = await getAntigravityStatus();
    const state = await loadState();
    const group = getViewGroup(state);
    const lines = [
      "📊 *AG Pilot 状态*",
      "",
      `CDP: ${status?.cdp?.connected ? "✅ 已连接" : "❌ 未连接"} (端口 ${status?.cdp?.port ?? "?"})`,
      `当前分组: ${group?.name ?? "无"}`,
      `CC 对话: ${group?.ccTitle || "未绑定"}`,
      `Codex 线程: ${group?.codexThreadId ? group.codexThreadId.slice(0, 12) + "..." : "未绑定"}`,
      `Codex 忙碌: ${group?.codexBusy ? "🔴 是" : "🟢 否"}`,
    ];
    await sendReply(chatId, lines.join("\n"));
  }

  async function cmdSend(chatId, text) {
    if (!text) return await sendReply(chatId, "用法: /send <消息内容>");
    const state = await loadState();
    const group = getViewGroup(state);
    if (!group?.ccTitle) return await sendReply(chatId, "当前分组未绑定 CC 对话");
    await sendTextToAntigravity({ title: group.ccTitle, text });
    await sendReply(chatId, `✅ 已发送到「${group.ccTitle}」`);
  }

  async function cmdRead(chatId) {
    const state = await loadState();
    const group = getViewGroup(state);
    if (!group?.ccTitle) return await sendReply(chatId, "当前分组未绑定 CC 对话");
    const reply = await readLatestAntigravityReply({ title: group.ccTitle });
    const text = reply?.text ?? "（无回复）";
    const truncated = text.length > 4000 ? text.slice(0, 4000) + "\n\n...(已截断)" : text;
    await sendReply(chatId, `💬 *CC 最新回复:*\n\n${truncated}`);
  }

  async function cmdHelp(chatId) {
    await sendReply(chatId, [
      "🤖 *AG Pilot Telegram 命令*",
      "",
      "/status — 查看 CDP、分组、绑定状态",
      "/send <文本> — 向当前分组的 CC 发消息",
      "/read — 读取当前分组 CC 的最新回复",
      "/help — 显示本帮助",
    ].join("\n"));
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/telegram-handler.test.mjs`
Expected: 7 tests PASS

- [ ] **Step 5: 提交**

```bash
git add lib/telegram-handler.mjs test/telegram-handler.test.mjs
git commit -m "feat: add Telegram command handler with /status /send /read /help"
```

---

## Task 3: Bot 入口文件

**Files:**
- Create: `telegram-bot.mjs`

- [ ] **Step 1: 创建入口文件**

```javascript
#!/usr/bin/env node
// telegram-bot.mjs
import { TelegramClient, startPolling } from "./lib/telegram.mjs";
import { createHandler } from "./lib/telegram-handler.mjs";
import {
  getAntigravityStatus,
  readLatestAntigravityReply,
  sendTextToAntigravity,
} from "./lib/antigravity-client.mjs";
import { loadState } from "./lib/config.mjs";

const token = process.env.AG_TELEGRAM_TOKEN;
if (!token) {
  console.error("环境变量 AG_TELEGRAM_TOKEN 未设置。");
  console.error("用法: AG_TELEGRAM_TOKEN=<your-bot-token> AG_TELEGRAM_CHAT_ID=<your-chat-id> node telegram-bot.mjs");
  process.exit(1);
}

const chatIdRaw = process.env.AG_TELEGRAM_CHAT_ID;
if (!chatIdRaw) {
  console.error("环境变量 AG_TELEGRAM_CHAT_ID 未设置。用 @userinfobot 获取你的 chat id。");
  process.exit(1);
}

const allowedChatIds = chatIdRaw.split(",").map((s) => Number(s.trim())).filter(Number.isFinite);

const client = new TelegramClient(token);
const handler = createHandler({
  allowedChatIds,
  sendReply: (chatId, text) => client.sendMessage(chatId, text),
  getAntigravityStatus,
  loadState,
  sendTextToAntigravity,
  readLatestAntigravityReply,
});

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());

console.log(`AG Pilot Telegram Bot 已启动，授权 chat IDs: [${allowedChatIds.join(", ")}]`);
const { done } = startPolling(client, handler, { signal: controller.signal });
await done;
console.log("Bot 已停止。");
```

- [ ] **Step 2: 手动验证启动（无 token 时应报错退出）**

Run: `node telegram-bot.mjs`
Expected: 打印 "环境变量 AG_TELEGRAM_TOKEN 未设置" 并退出码 1

- [ ] **Step 3: 提交**

```bash
git add telegram-bot.mjs
git commit -m "feat: add Telegram bot entry point with env-based auth"
```

---

## Task 4: LaunchAgent 安装脚本

**Files:**
- Create: `scripts/install-telegram-service.sh`

- [ ] **Step 1: 创建安装脚本**

```bash
#!/bin/bash
# scripts/install-telegram-service.sh
# 注册 macOS LaunchAgent 让 Telegram Bot 后台运行
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_LABEL="com.ag-pilot.telegram-bot"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

if [ -z "${AG_TELEGRAM_TOKEN:-}" ]; then
  echo "请先设置 AG_TELEGRAM_TOKEN 环境变量"
  exit 1
fi

if [ -z "${AG_TELEGRAM_CHAT_ID:-}" ]; then
  echo "请先设置 AG_TELEGRAM_CHAT_ID 环境变量"
  exit 1
fi

NODE_PATH="$(which node)"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${PROJECT_DIR}/telegram-bot.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AG_TELEGRAM_TOKEN</key>
    <string>${AG_TELEGRAM_TOKEN}</string>
    <key>AG_TELEGRAM_CHAT_ID</key>
    <string>${AG_TELEGRAM_CHAT_ID}</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${PROJECT_DIR}/logs/telegram-bot.log</string>
  <key>StandardErrorPath</key>
  <string>${PROJECT_DIR}/logs/telegram-bot.log</string>
</dict>
</plist>
EOF

mkdir -p "$PROJECT_DIR/logs"
launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"

echo "✅ Telegram Bot 服务已注册: ${PLIST_LABEL}"
echo "   日志: ${PROJECT_DIR}/logs/telegram-bot.log"
echo "   停止: launchctl bootout gui/$(id -u)/${PLIST_LABEL}"
```

- [ ] **Step 2: 添加执行权限并提交**

```bash
chmod +x scripts/install-telegram-service.sh
echo "logs/" >> .gitignore
git add scripts/install-telegram-service.sh .gitignore
git commit -m "feat: add LaunchAgent installer for Telegram bot"
```

---

## Task 5: 更新文档

**Files:**
- Modify: `README.md`
- Modify: `README-zh.md`

- [ ] **Step 1: 在 README-zh.md 的"## 功能"表格后追加 Telegram 章节**

在 `## 配置` 之前插入：

```markdown
## Telegram 远程控制

通过 Telegram Bot 远程向 CC 发消息、读回复、查看状态。

### 设置步骤

1. 在 Telegram 找 @BotFather，创建一个新 Bot，拿到 token
2. 在 Telegram 找 @userinfobot，获取你的 chat ID
3. 设置环境变量并启动：

\```bash
export AG_TELEGRAM_TOKEN="你的bot-token"
export AG_TELEGRAM_CHAT_ID="你的chat-id"
node telegram-bot.mjs
\```

4. 后台运行（可选）：

\```bash
AG_TELEGRAM_TOKEN="你的bot-token" AG_TELEGRAM_CHAT_ID="你的chat-id" ./scripts/install-telegram-service.sh
\```

### 命令

| 命令 | 用途 |
|------|------|
| `/status` | 查看 CDP 连接、当前分组、绑定状态 |
| `/send <文本>` | 向当前分组的 CC 对话发送消息 |
| `/read` | 读取当前分组 CC 的最新回复 |
| `/help` | 显示帮助 |
```

- [ ] **Step 2: 同步更新 README.md（英文版）**

在 README.md 对应位置插入等价的英文 Telegram 章节。

- [ ] **Step 3: 提交**

```bash
git add README.md README-zh.md
git commit -m "docs: add Telegram remote control section to READMEs"
```

---

## Task 6: 全量测试验证

- [ ] **Step 1: 运行全部测试**

Run: `node --test test/*.test.mjs`
Expected: 所有测试 PASS，无回归

- [ ] **Step 2: 最终提交（如有遗漏修改）**

```bash
git add -A
git status
# 如果有未提交的改动，补一个 commit
```
