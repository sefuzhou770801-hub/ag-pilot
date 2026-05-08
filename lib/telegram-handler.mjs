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
        case "list":
          return await cmdList(chatId);
        case "peek":
          return await cmdPeek(chatId);
        case "pause":
          return await cmdPause(chatId);
        case "resume":
          return await cmdResume(chatId);
        case "stop":
          return await cmdStop(chatId);
        case "disconnect":
          return await cmdDisconnect(chatId);
        case "start":
        case "help":
          return await cmdHelp(chatId);
        default:
          return await sendReply(chatId, `Unknown command: /${parsed.command}\nType /help for available commands`);
      }
    } catch (err) {
      await sendReply(chatId, `Error: ${err.message}`);
    }
  };

  async function cmdStatus(chatId) {
    const status = await getAntigravityStatus();
    const state = await loadState();
    const group = getViewGroup(state);
    const lines = [
      "*AG Pilot Status*",
      "",
      `CDP: ${status?.cdp?.connected ? "✅ Connected" : "❌ Disconnected"} (:${status?.cdp?.port ?? "?"})`,
      `Group: ${group?.name ?? "none"}`,
      `Antigravity: ${group?.agTitle || "not bound"}`,
      `Codex: ${group?.codexThreadId ? group.codexThreadId.slice(0, 12) + "..." : "not bound"}`,
      `Codex busy: ${group?.codexBusy ? "🔴 yes" : "🟢 no"}`,
    ];
    await sendReply(chatId, lines.join("\n"));
  }

  async function cmdSend(chatId, text) {
    if (!text) return await sendReply(chatId, "Usage: /send <message>");
    const state = await loadState();
    const group = getViewGroup(state);
    if (!group?.agTitle) return await sendReply(chatId, "No Antigravity conversation bound for current group");
    await sendTextToAntigravity({ title: group.agTitle, text });
    await sendReply(chatId, `✅ Sent to "${group.agTitle}"`);
  }

  async function cmdRead(chatId) {
    const state = await loadState();
    const group = getViewGroup(state);
    if (!group?.agTitle) return await sendReply(chatId, "No Antigravity conversation bound for current group");
    const reply = await readLatestAntigravityReply({ title: group.agTitle });
    const text = reply?.text ?? "(no reply)";
    const truncated = text.length > 4000 ? text.slice(0, 4000) + "\n\n...(truncated)" : text;
    await sendReply(chatId, `*Latest reply:*\n\n${truncated}`);
  }

  async function cmdList(chatId) {
    const conversations = await listAntigravityConversations();
    if (!conversations || conversations.length === 0) {
      return await sendReply(chatId, "No active Antigravity conversations found.");
    }
    const lines = ["*Active Agents:*", ""];
    for (const conv of conversations) {
      const icon = conv.running ? "🔴" : conv.selected ? "🟢" : conv.recent ? "🟡" : "⚪";
      const status = conv.running ? "running" : conv.selected ? "active" : conv.recent ? "recent" : "idle";
      lines.push(`${icon} ${conv.title} (${status})`);
    }
    await sendReply(chatId, lines.join("\n"));
  }

  async function cmdPeek(chatId) {
    await sendReply(chatId, "📸 Capturing screenshot...");
    const buffer = await captureAntigravityScreenshot();
    await sendPhoto(chatId, buffer, "AG Pilot — Live IDE");
  }

  async function cmdPause(chatId) {
    const state = await loadState();
    const data = { ...state.data, paused: true, updatedAt: new Date().toISOString() };
    await saveState(data);
    await sendReply(chatId, "⏸ AG Pilot paused.\nAuto-routing is suspended.\nUse /resume to restore.");
  }

  async function cmdResume(chatId) {
    const state = await loadState();
    const data = { ...state.data, paused: false, updatedAt: new Date().toISOString() };
    await saveState(data);
    await sendReply(chatId, "▶️ AG Pilot resumed.\nAuto-routing is active.");
  }

  async function cmdStop(chatId) {
    const result = await stopAntigravityAgent();
    const state = await loadState();
    const groups = state.data.groups.map((g) => ({ ...g, codexBusy: false }));
    const data = { ...state.data, groups, paused: true, updatedAt: new Date().toISOString() };
    await saveState(data);

    const stopStatus = result.stopped ? "✅ Antigravity stop button clicked" : "⚠️ No active agent stop button found";
    await sendReply(chatId, `🛑 *Emergency Stop*\n\n${stopStatus}\nAll Codex busy states cleared.\nAuto-routing paused.\n\nUse /resume to restore.`);
  }

  async function cmdDisconnect(chatId) {
    const state = await loadState();
    const group = getViewGroup(state);
    if (!group) return await sendReply(chatId, "No active group to disconnect.");
    const data = updateViewGroup(state, { agTitle: "", codexThreadId: "" });
    await saveState(data);
    await sendReply(chatId, `🔌 Disconnected group "${group.name}".\nBindings cleared.`);
  }

  async function cmdHelp(chatId) {
    await sendReply(chatId, [
      "*AG Pilot Commands*",
      "",
      "/status — Check CDP, group, binding status",
      "/list — Show active agents",
      "/peek — Screenshot your live IDE",
      "/send <text> — Send to bound Antigravity",
      "/read — Read latest Antigravity reply",
      "/pause — Pause auto-routing",
      "/resume — Resume auto-routing",
      "/stop — Emergency stop all agents",
      "/disconnect — Clear current group bindings",
      "/help — Show this help",
    ].join("\n"));
  }
}
