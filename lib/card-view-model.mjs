export function buildCardViewModel({ state, status, conversations, codexThreads = [], codexDb = {}, boundThreadTitle = null }) {
  const stateData = state?.data ?? {};
  const boundCcTitle = stateData.ccTitle ?? "";
  const boundThreadId = stateData.codexThreadId ?? "";
  const selectedConversation = conversations?.find((item) => item.selected) ?? conversations?.[0] ?? null;
  const latestCodexThread = codexThreads[0] ?? null;
  const selectedTitle = selectedConversation?.title ?? "";
  const cdpConnected = Boolean(status?.autoAccept?.cdp?.connected);
  const codexSocketReady = Boolean(status?.codex?.socketExists);
  const ccMatched = boundCcTitle && selectedTitle && normalize(boundCcTitle) === normalize(selectedTitle);
  const risk = computeRisk({ boundCcTitle, selectedTitle, cdpConnected, codexSocketReady });

  // Codex 对话标题：优先从数据库取，其次用 thread ID 缩写
  const codexDbThreads = codexDb?.threads ?? [];
  const latestDbThread = codexDbThreads[0] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    cc: {
      boundTitle: boundCcTitle,
      selectedTitle,
      workspace: selectedConversation?.workspace ?? "",
      status: selectedConversation?.status ?? "unknown",
      running: Boolean(selectedConversation?.running),
      recent: Boolean(selectedConversation?.recent),
      matched: ccMatched,
      confidence: ccMatched ? 100 : selectedTitle ? 68 : 0,
    },
    codex: {
      boundThreadId,
      boundTitle: boundThreadTitle || "",
      boundThreadShort: shortenThreadId(boundThreadId),
      latestThreadId: latestDbThread?.threadId ?? latestCodexThread?.threadId ?? "",
      latestTitle: latestDbThread?.title ?? "",
      latestThreadShort: latestCodexThread?.threadShort ?? "",
      socketReady: codexSocketReady,
      confidence: codexSocketReady && boundThreadId ? 100 : codexSocketReady && latestCodexThread ? 78 : codexSocketReady ? 72 : 0,
      dbThreads: codexDbThreads,
    },
    bridge: {
      autoAcceptVersion: status?.autoAccept?.plugin?.version ?? "",
      cdpConnected,
      cdpPort: status?.autoAccept?.settings?.cdpPort ?? null,
      conversationCount: conversations?.length ?? 0,
    },
    risk: computeCodexRisk(risk, boundThreadId, latestCodexThread),
  };
}

export function shortenThreadId(threadId) {
  if (!threadId) return "";
  if (threadId.length <= 18) return threadId;
  return `${threadId.slice(0, 8)}...${threadId.slice(-5)}`;
}

function computeRisk({ boundCcTitle, selectedTitle, cdpConnected, codexSocketReady }) {
  if (!cdpConnected) {
    return { level: "danger", message: "AutoAccept 未连接" };
  }
  if (!codexSocketReady) {
    return { level: "danger", message: "Codex 未连接" };
  }
  if (!boundCcTitle) {
    return { level: "warning", message: "CC 对话未绑定，请选择" };
  }
  return { level: "ok", message: "双向通道就绪" };
}

function computeCodexRisk(baseRisk, boundThreadId, latestCodexThread) {
  if (baseRisk.level === "danger") return baseRisk;
  if (!boundThreadId) {
    return { level: "warning", message: "Codex 对话未绑定，请选择" };
  }
  if (baseRisk.level === "warning") return baseRisk;
  return { level: "ok", message: "双向通道就绪" };
}

function normalize(text) {
  return String(text ?? "").trim().toLowerCase();
}
