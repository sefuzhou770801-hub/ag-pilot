import { normalizeStateData } from "./config.mjs";

export function buildCardViewModel({
  state,
  status,
  conversations,
  codexThreads = [],
  codexDb = {},
  boundThreadTitle = null,
  antigravityBusy = { known: false, busy: null },
}) {
  const stateData = normalizeStateData(stripActiveAliasesWhenGrouped(state?.data ?? {}));
  const activeGroup = stateData.groups.find((group) => group.id === stateData.activeGroupId) ?? stateData.groups[0];
  const boundCcTitle = activeGroup?.ccTitle ?? "";
  const boundThreadId = activeGroup?.codexThreadId ?? "";
  const codexBusy = Boolean(activeGroup?.codexBusy);
  const boundConversation = conversations?.find((item) => normalize(item.title) === normalize(boundCcTitle)) ?? null;
  const latestCodexThread = codexThreads[0] ?? null;
  const antigravityStatus = status?.antigravity ?? {};
  const cdpConnected = Boolean(antigravityStatus?.cdp?.connected);
  const codexSocketReady = Boolean(status?.codex?.socketExists);
  const ccBound = Boolean(boundCcTitle);
  const risk = computeRisk({ boundCcTitle, cdpConnected, codexSocketReady });

  // Codex 对话标题：优先从数据库取，其次用 thread ID 缩写
  const codexDbThreads = codexDb?.threads ?? [];
  const latestDbThread = codexDbThreads[0] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    groups: stateData.groups.map((group) => ({
      id: group.id,
      name: group.name,
      ccTitle: group.ccTitle,
      codexThreadId: group.codexThreadId,
      codexBusy: Boolean(group.codexBusy),
      active: group.id === stateData.activeGroupId,
    })),
    activeGroupId: stateData.activeGroupId,
    activeGroupName: activeGroup?.name ?? "",
    cc: {
      boundTitle: boundCcTitle,
      workspace: boundConversation?.workspace ?? "",
      status: boundConversation?.status ?? (ccBound ? "bound" : "unknown"),
      running: Boolean(boundConversation?.running),
      recent: Boolean(boundConversation?.recent),
      matched: ccBound,
      confidence: ccBound ? 100 : 0,
      busy: antigravityBusy.known ? Boolean(antigravityBusy.busy) : null,
      busyKnown: Boolean(antigravityBusy.known),
      statusLabel: antigravityBusy.known ? (antigravityBusy.busy ? "思考中" : "空闲") : "未知",
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
      busy: codexBusy,
      statusLabel: codexBusy ? "执行中" : "空闲",
    },
    bridge: {
      antigravityConfigSource: antigravityStatus?.config?.source ?? "",
      cdpConnected,
      cdpPort: antigravityStatus?.config?.cdpPort ?? null,
      conversationCount: conversations?.length ?? 0,
    },
    risk: computeActivityRisk(computeCodexRisk(risk, boundThreadId, latestCodexThread), {
      ccBusy: antigravityBusy.known ? Boolean(antigravityBusy.busy) : false,
      codexBusy,
    }),
  };
}

function stripActiveAliasesWhenGrouped(data) {
  if (!Array.isArray(data?.groups) || data.groups.length === 0) return data;
  const { ccTitle, codexThreadId, ...groupedData } = data;
  return groupedData;
}

export function shortenThreadId(threadId) {
  if (!threadId) return "";
  if (threadId.length <= 18) return threadId;
  return `${threadId.slice(0, 8)}...${threadId.slice(-5)}`;
}

function computeRisk({ boundCcTitle, cdpConnected, codexSocketReady }) {
  if (!cdpConnected) {
    return { level: "danger", message: "Antigravity CDP 未连接" };
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

function computeActivityRisk(baseRisk, { ccBusy, codexBusy }) {
  if (baseRisk.level !== "ok") return baseRisk;
  if (ccBusy && codexBusy) return { level: "ok", message: "双向执行中" };
  if (ccBusy) return { level: "ok", message: "CC 思考中..." };
  if (codexBusy) return { level: "ok", message: "Codex 执行中..." };
  return baseRisk;
}

function normalize(text) {
  return String(text ?? "").trim().toLowerCase();
}
