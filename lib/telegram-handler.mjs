import { getViewGroup } from "./config.mjs";

export function parseCommand(text) {
  if (!text || !text.startsWith("/")) return null;
  const match = text.match(/^\/(\w+)(?:@\S+)?\s*(.*)/s);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: match[2].trim() };
}

// 确认机制：每个 chatId 追踪最近一次待确认的危险操作
const pendingConfirms = new Map();
const CONFIRM_EXPIRY_MS = 30_000;

function setPendingConfirm(chatId, action) {
  pendingConfirms.set(chatId, { action, at: Date.now() });
}

function consumePendingConfirm(chatId, action) {
  const entry = pendingConfirms.get(chatId);
  if (!entry || entry.action !== action) return false;
  if (Date.now() - entry.at > CONFIRM_EXPIRY_MS) {
    pendingConfirms.delete(chatId);
    return false;
  }
  pendingConfirms.delete(chatId);
  return true;
}

export function createHandler(dependencies) {
  const {
    allowedChatIds,
    sendReply,
    sendPhoto,
    getAntigravityStatus,
    loadState,
    saveState,
    sendTextToAntigravity,
    readLatestAntigravityReply,
    listAntigravityConversations,
    captureAntigravityScreenshot,
    stopAntigravityAgent,
    updateViewGroup,
    isAntigravityBusy,
    replyTimeoutMs,
    replyPollMs,
  } = dependencies;

  const REPLY_TIMEOUT = replyTimeoutMs ?? 120_000;
  const REPLY_POLL = replyPollMs ?? 3000;

  const allowed = new Set(allowedChatIds);

  return async function handle(update) {
    const message = update?.message;
    if (!message?.chat?.id || !message?.text) return;
    const chatId = message.chat.id;
    if (!allowed.has(chatId)) return;

    const parsed = parseCommand(message.text);

    // 修复1: 普通消息直接当聊天内容发给反重力
    if (!parsed) {
      return await chatDirectly(chatId, message.text);
    }

    try {
      switch (parsed.command) {
        case "status":
          return await cmdStatus(chatId);
        case "send":
          return await cmdSend(chatId, parsed.args);
        case "read":
          return await cmdRead(chatId);
        case "list":
          return await cmdList(chatId);
        case "use":
          return await cmdUse(chatId, parsed.args);
        case "peek":
          return await cmdPeek(chatId);
        case "pause":
          return await cmdPause(chatId);
        case "resume":
          return await cmdResume(chatId);
        case "stop":
          return await cmdStop(chatId);
        case "confirm_stop":
          return await cmdConfirmStop(chatId);
        case "disconnect":
          return await cmdDisconnect(chatId);
        case "confirm_disconnect":
          return await cmdConfirmDisconnect(chatId);
        case "start":
        case "help":
          return await cmdHelp(chatId);
        default:
          return await sendReply(chatId, `Unknown command: /${parsed.command}\nType /help for available commands`);
      }
    } catch (err) {
      await sendReply(chatId, `❌ Error: ${err.message}`);
    }
  };

  // 修复1+6: 普通消息直接发给反重力，暂停时阻断并提示
  async function chatDirectly(chatId, text) {
    const state = await loadState();

    // 修复6: 暂停中阻断普通聊天
    if (state.data.paused) {
      return await sendReply(chatId, "⏸ AG Pilot is paused. Your message was not sent.\nUse /resume to restore, then try again.");
    }

    const group = getViewGroup(state);
    if (!group?.agTitle) {
      return await sendReply(chatId, "No conversation bound. Use /list to see available conversations, then /use <number> to select one.");
    }

    try {
      await sendTextToAntigravity({ title: group.agTitle, text });
    } catch (err) {
      return await sendReply(chatId, `❌ Failed to send: ${err.message}`);
    }

    // 修复2: 发送后提示等待
    await sendReply(chatId, `📤 Sent to "${group.agTitle}". Waiting for reply...`);

    // 修复2: 等待回复并自动回推
    await waitAndPushReply(chatId, group.agTitle);
  }

  // 修复2: 等待反重力回复并自动推送
  async function waitAndPushReply(chatId, agTitle, timeoutMs = REPLY_TIMEOUT) {
    const pollInterval = REPLY_POLL;
    const start = Date.now();
    let wasBusy = false;

    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollInterval));
      try {
        const busy = isAntigravityBusy ? await isAntigravityBusy().catch(() => false) : false;
        if (busy) {
          wasBusy = true;
          continue;
        }
        if (wasBusy) {
          // busy→idle: 回复完成
          const reply = await readLatestAntigravityReply({ title: agTitle }).catch(() => null);
          if (reply?.text) {
            const truncated = reply.text.length > 4000
              ? reply.text.slice(0, 4000) + "\n\n...(truncated)"
              : reply.text;
            await sendReply(chatId, `💬 *Reply:*\n\n${truncated}`);
          } else {
            await sendReply(chatId, "⚠️ Reply received but content is empty.");
          }
          return;
        }
      } catch {
        // CDP 不可用，继续等
      }
    }

    // 超时
    await sendReply(chatId, "⏰ Timed out waiting for reply (2 min). Use /read to check later.");
  }

  async function cmdStatus(chatId) {
    const status = await getAntigravityStatus();
    const state = await loadState();
    const group = getViewGroup(state);

    // 修复4: busy 状态展示
    let agStatus = "idle";
    if (isAntigravityBusy) {
      try {
        const busy = await isAntigravityBusy();
        if (busy) agStatus = "🧠 thinking...";
      } catch { /* CDP not available */ }
    }

    const lines = [
      "*AG Pilot Status*",
      "",
      `CDP: ${status?.cdp?.connected ? "✅ Connected" : "❌ Disconnected"} (:${status?.cdp?.port ?? "?"})`,
      `Group: ${group?.name ?? "none"}`,
      `Chatting with: ${group?.agTitle || "⚠️ not bound — use /list"}`,
      `Antigravity: ${agStatus}`,
      `Codex: ${group?.codexThreadId ? group.codexThreadId.slice(0, 12) + "..." : "not bound"}`,
      `Codex busy: ${group?.codexBusy ? "🔴 yes" : "🟢 no"}`,
      `Paused: ${state.data.paused ? "⏸ yes" : "▶️ no"}`,
    ];
    await sendReply(chatId, lines.join("\n"));
  }

  async function cmdSend(chatId, text) {
    if (!text) return await sendReply(chatId, "Usage: /send <message>\nOr just type your message directly.");

    const state = await loadState();
    if (state.data.paused) {
      return await sendReply(chatId, "⏸ AG Pilot is paused. Use /resume first.");
    }

    const group = getViewGroup(state);
    if (!group?.agTitle) return await sendReply(chatId, "No conversation bound. Use /list then /use <number>.");
    await sendTextToAntigravity({ title: group.agTitle, text });
    await sendReply(chatId, `📤 Sent to "${group.agTitle}". Waiting for reply...`);
    await waitAndPushReply(chatId, group.agTitle);
  }

  async function cmdRead(chatId) {
    const state = await loadState();
    const group = getViewGroup(state);
    if (!group?.agTitle) return await sendReply(chatId, "No conversation bound. Use /list then /use <number>.");
    const reply = await readLatestAntigravityReply({ title: group.agTitle });
    const text = reply?.text ?? "(no reply)";
    const truncated = text.length > 4000 ? text.slice(0, 4000) + "\n\n...(truncated)" : text;
    await sendReply(chatId, `*Latest reply:*\n\n${truncated}`);
  }

  // 修复3: /list 显示带编号的列表，支持 /use 切换
  async function cmdList(chatId) {
    const conversations = await listAntigravityConversations();
    if (!conversations || conversations.length === 0) {
      return await sendReply(chatId, "No active Antigravity conversations found.");
    }
    const state = await loadState();
    const group = getViewGroup(state);
    const currentTitle = group?.agTitle ?? "";

    const lines = ["*Active Conversations:*", ""];
    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i];
      const isCurrent = conv.title === currentTitle;
      const icon = isCurrent ? "👉" : conv.running ? "🔴" : conv.selected ? "🟢" : "⚪";
      const tag = isCurrent ? " ← current" : "";
      lines.push(`${icon} ${i + 1}. ${conv.title}${tag}`);
    }
    lines.push("");
    lines.push("Use /use <number> to switch.");
    await sendReply(chatId, lines.join("\n"));
  }

  // 修复3: /use 切换当前对话
  async function cmdUse(chatId, args) {
    if (!args) return await sendReply(chatId, "Usage: /use <number or title>\nUse /list to see available conversations.");

    const conversations = await listAntigravityConversations();
    if (!conversations || conversations.length === 0) {
      return await sendReply(chatId, "No conversations available.");
    }

    let target = null;
    const num = parseInt(args, 10);
    if (Number.isFinite(num) && num >= 1 && num <= conversations.length) {
      target = conversations[num - 1];
    } else {
      const needle = args.toLowerCase();
      target = conversations.find((c) => c.title.toLowerCase().includes(needle));
    }

    if (!target) {
      return await sendReply(chatId, `Conversation not found: "${args}"\nUse /list to see available conversations.`);
    }

    const state = await loadState();
    const data = updateViewGroup(state, { agTitle: target.title });
    await saveState(data);
    await sendReply(chatId, `✅ Now chatting with: *${target.title}*`);
  }

  // 修复5: /peek 文案优化
  async function cmdPeek(chatId) {
    const state = await loadState();
    const group = getViewGroup(state);
    const caption = group?.agTitle
      ? `AG Pilot — ${group.agTitle}`
      : "AG Pilot — IDE overview (no specific conversation bound)";
    await sendReply(chatId, "📸 Capturing screenshot...");
    const buffer = await captureAntigravityScreenshot();
    await sendPhoto(chatId, buffer, caption);
  }

  // 修复6: /pause 真暂停
  async function cmdPause(chatId) {
    const state = await loadState();
    const data = { ...state.data, paused: true, updatedAt: new Date().toISOString() };
    await saveState(data);
    await sendReply(chatId, "⏸ AG Pilot paused.\nAuto-routing and chat are suspended.\n/read /status /peek /resume /stop still work.\nUse /resume to restore.");
  }

  async function cmdResume(chatId) {
    const state = await loadState();
    const data = { ...state.data, paused: false, updatedAt: new Date().toISOString() };
    await saveState(data);
    await sendReply(chatId, "▶️ AG Pilot resumed. You can chat normally now.");
  }

  // 修复7: /stop 需要确认
  async function cmdStop(chatId) {
    setPendingConfirm(chatId, "stop");
    await sendReply(chatId, "🛑 *Emergency Stop*\n\nThis will stop all agents and pause routing.\nSend /confirm\\_stop within 30 seconds to proceed.");
  }

  async function cmdConfirmStop(chatId) {
    if (!consumePendingConfirm(chatId, "stop")) {
      return await sendReply(chatId, "No pending /stop to confirm (expired or not requested).\nSend /stop first.");
    }
    const result = await stopAntigravityAgent();
    const state = await loadState();
    const groups = state.data.groups.map((g) => ({ ...g, codexBusy: false }));
    const data = { ...state.data, groups, paused: true, updatedAt: new Date().toISOString() };
    await saveState(data);

    const stopStatus = result.stopped ? "✅ Antigravity stop button clicked" : "⚠️ No active agent stop button found";
    await sendReply(chatId, `🛑 *Stop Confirmed*\n\n${stopStatus}\nAll Codex busy states cleared.\nAuto-routing paused.\n\nUse /resume to restore.`);
  }

  // 修复7: /disconnect 需要确认
  async function cmdDisconnect(chatId) {
    const state = await loadState();
    const group = getViewGroup(state);
    if (!group) return await sendReply(chatId, "No active group to disconnect.");
    setPendingConfirm(chatId, "disconnect");
    await sendReply(chatId, `🔌 *Disconnect "${group.name}"?*\n\nThis will clear all bindings for this group.\nSend /confirm\\_disconnect within 30 seconds to proceed.`);
  }

  async function cmdConfirmDisconnect(chatId) {
    if (!consumePendingConfirm(chatId, "disconnect")) {
      return await sendReply(chatId, "No pending /disconnect to confirm (expired or not requested).\nSend /disconnect first.");
    }
    const state = await loadState();
    const group = getViewGroup(state);
    if (!group) return await sendReply(chatId, "No active group to disconnect.");
    const data = updateViewGroup(state, { agTitle: "", codexThreadId: "" });
    await saveState(data);
    await sendReply(chatId, `🔌 Disconnected group "${group.name}". Bindings cleared.`);
  }

  async function cmdHelp(chatId) {
    await sendReply(chatId, [
      "*AG Pilot — Chat with Antigravity*",
      "",
      "Just type your message to chat directly.",
      "",
      "*Commands:*",
      "/status — Connection & chat status",
      "/list — Show conversations",
      "/use <n> — Switch conversation",
      "/peek — Screenshot current IDE",
      "/read — Read latest reply",
      "/send <text> — Send (explicit)",
      "/pause — Pause chat & routing",
      "/resume — Resume chat",
      "/stop — Emergency stop (needs confirm)",
      "/disconnect — Clear bindings (needs confirm)",
      "/help — Show this help",
    ].join("\n"));
  }
}
