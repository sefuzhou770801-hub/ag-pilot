/* ============================================================
   CC Codex Bridge — 卡片前端逻辑 V2
   只做状态确认 + 下拉绑定，没有发送按钮
   ============================================================ */

const $ = (id) => document.getElementById(id);

const el = {
  groupTabs: $("groupTabs"),
  addGroupBtn: $("addGroupBtn"),
  ccCard: $("ccCard"),
  ccName: $("ccName"),
  ccStatus: $("ccStatus"),
  ccSection: $("ccSection"),
  ccDropdown: $("ccDropdown"),
  ccList: $("ccList"),
  codexCard: $("codexCard"),
  codexName: $("codexName"),
  codexStatus: $("codexStatus"),
  codexSection: $("codexSection"),
  codexDropdown: $("codexDropdown"),
  codexList: $("codexList"),
  bridgeArrow: $("bridgeArrow"),
  safetyBanner: $("safetyBanner"),
  safetyDot: $("safetyDot"),
  safetyText: $("safetyText"),
  safetyAction: $("safetyAction"),
  footerText: $("footerText"),
  footerTime: $("footerTime"),
};

let lastSnapshot = null;
let uiBusy = false;

/* ---- 分组操作 ---- */

el.addGroupBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  const name = prompt("新分组名称", `分组 ${(lastSnapshot?.view?.groups?.length ?? 0) + 1}`);
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return;
  await postJson("/api/groups/create", { name: trimmed });
  pulseArrow();
  await refresh();
});

el.safetyAction.addEventListener("click", async (e) => {
  e.stopPropagation();
  const snap = lastSnapshot;
  const selectedTitle = snap?.view?.cc?.selectedTitle;
  if (!selectedTitle) return;
  const matchedGroup = findGroupForSelectedCc(snap);
  if (matchedGroup) {
    await switchGroup(matchedGroup.id);
  } else {
    await bindCcConversation(selectedTitle);
    return;
  }
  pulseArrow();
  await refresh();
});

/* ---- 点击节点卡片展开/收起 ---- */

el.ccCard.addEventListener("click", () => {
  el.ccSection.classList.toggle("open");
  el.codexSection.classList.remove("open");
});

el.codexCard.addEventListener("click", () => {
  el.codexSection.classList.toggle("open");
  el.ccSection.classList.remove("open");
});

// 点击外部收起
document.addEventListener("click", (e) => {
  if (!el.ccSection.contains(e.target)) el.ccSection.classList.remove("open");
  if (!el.codexSection.contains(e.target)) el.codexSection.classList.remove("open");
});

/* ---- 自动刷新 ---- */

await refresh();
setInterval(() => {
  if (uiBusy || isMenuOpen()) return;
  refresh();
}, 3000);

/* ---- 核心逻辑 ---- */

async function refresh() {
  try {
    const snap = await fetchSnapshot();
    lastSnapshot = await followSelectedCcGroup(snap);
    render(lastSnapshot);
  } catch (err) {
    el.footerText.textContent = `连接失败`;
    el.safetyBanner.className = "safety danger";
    el.safetyText.textContent = "桥接器未响应";
  }
}

async function fetchSnapshot() {
  const res = await fetch("/api/snapshot", { cache: "no-store" });
  return await res.json();
}

async function followSelectedCcGroup(snap) {
  if (uiBusy || isMenuOpen()) return snap;
  const matchedGroup = findGroupForSelectedCc(snap);
  if (!matchedGroup) return snap;
  uiBusy = true;
  try {
    el.footerText.textContent = "切换分组中";
    await switchGroup(matchedGroup.id);
    pulseArrow();
    return await fetchSnapshot();
  } finally {
    uiBusy = false;
  }
}

function render(snap) {
  const v = snap.view;
  const convs = snap.conversations || [];

  renderGroups(v.groups || []);

  // ---- CC 节点 ----
  if (v.cc.boundTitle) {
    el.ccName.textContent = v.cc.boundTitle;
    el.ccStatus.textContent = v.cc.matched ? "✓ 当前" : "✓";
    el.ccStatus.className = "node-status";
  } else if (v.cc.selectedTitle) {
    el.ccName.textContent = v.cc.selectedTitle;
    el.ccStatus.textContent = "点击绑定";
    el.ccStatus.className = "node-status unbound";
  } else {
    el.ccName.textContent = "未检测到对话";
    el.ccStatus.textContent = "";
    el.ccStatus.className = "node-status warning";
  }

  // CC 下拉列表
  el.ccList.innerHTML = "";
  convs.forEach((conv) => {
    const isBound = conv.title === v.cc.boundTitle;
    const item = document.createElement("button");
    item.className = "dropdown-item" + (isBound ? " active" : "");
    const meta = isBound ? "已选" : conv.selected ? "当前" : "";
    item.innerHTML = `
      <span class="dropdown-item-name">${esc(conv.title || "无标题")}</span>
      <span class="dropdown-item-meta">${meta}</span>`;
    item.addEventListener("click", async (e) => {
      e.stopPropagation();
      await bindCcConversation(conv.title);
    });
    el.ccList.appendChild(item);
  });

  // ---- Codex 节点 ----
  if (v.codex.boundThreadId) {
    el.codexName.textContent = v.codex.boundTitle || v.codex.boundThreadShort;
    el.codexStatus.textContent = "✓";
    el.codexStatus.className = "node-status";
  } else {
    el.codexName.textContent = "未绑定 Codex 对话";
    el.codexStatus.textContent = "点击绑定";
    el.codexStatus.className = "node-status unbound";
  }

  // Codex 下拉列表
  el.codexList.innerHTML = "";
  const dbThreads = v.codex.dbThreads || [];
  dbThreads.forEach((thread) => {
    const item = document.createElement("button");
    const isBound = thread.threadId === v.codex.boundThreadId;
    item.className = "dropdown-item" + (isBound ? " active" : "");
    item.innerHTML = `
      <span class="dropdown-item-name">${esc(thread.title)}</span>
      <span class="dropdown-item-meta">${timeAgo(thread.updatedAt)}</span>`;
    item.addEventListener("click", async (e) => {
      e.stopPropagation();
      await bindCodexThread(thread);
    });
    el.codexList.appendChild(item);
  });

  renderSafety(snap);

  // ---- 底部 ----
  el.footerText.textContent = v.bridge.cdpConnected ? "周瑟夫" : "未连接";
  el.footerTime.textContent = new Date(v.generatedAt).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function renderSafety(snap) {
  const v = snap.view;
  const risk = v.risk;
  el.safetyBanner.className = `safety ${risk.level}`;
  el.safetyAction.hidden = true;
  el.safetyAction.textContent = "";

  if (risk.level === "ok") {
    el.safetyText.textContent = "双向通道就绪";
    return;
  }

  const selectedTitle = v.cc.selectedTitle;
  if (risk.level === "warning" && selectedTitle && v.cc.boundTitle && !v.cc.matched) {
    const matchedGroup = findGroupForSelectedCc(snap);
    if (matchedGroup) {
      el.safetyText.textContent = `当前 CC 属于「${matchedGroup.name}」`;
      el.safetyAction.textContent = "切过去";
    } else {
      el.safetyText.textContent = "当前 CC 未绑定到本分组";
      el.safetyAction.textContent = "绑定当前";
    }
    el.safetyAction.hidden = false;
    return;
  }

  el.safetyText.textContent = risk.message;
}

async function bindCcConversation(title) {
  if (!title) return;
  uiBusy = true;
  el.ccName.textContent = title;
  el.ccStatus.textContent = "保存中";
  el.ccStatus.className = "node-status unbound";
  try {
    await postJson("/api/bind/cc", { title });
    el.ccSection.classList.remove("open");
    pulseArrow();
    await refresh();
  } catch {
    el.footerText.textContent = "CC 保存失败";
    el.safetyBanner.className = "safety danger";
    el.safetyText.textContent = "CC 对话没有保存，请再点一次";
  } finally {
    uiBusy = false;
  }
}

async function bindCodexThread(thread) {
  if (!thread?.threadId) return;
  uiBusy = true;
  el.codexName.textContent = thread.title || thread.threadId;
  el.codexStatus.textContent = "保存中";
  el.codexStatus.className = "node-status unbound";
  try {
    await postJson("/api/bind/codex", { threadId: thread.threadId });
    el.codexSection.classList.remove("open");
    pulseArrow();
    await refresh();
  } catch {
    el.footerText.textContent = "Codex 保存失败";
    el.safetyBanner.className = "safety danger";
    el.safetyText.textContent = "Codex 对话没有保存，请再点一次";
  } finally {
    uiBusy = false;
  }
}

function isMenuOpen() {
  return el.ccSection.classList.contains("open") || el.codexSection.classList.contains("open");
}

function renderGroups(groups) {
  el.groupTabs.innerHTML = "";
  groups.forEach((group) => {
    const tab = document.createElement("button");
    tab.className = "group-tab" + (group.active ? " active" : "");
    tab.type = "button";
    tab.textContent = group.name || "未命名";
    tab.title = group.name || "未命名";
    tab.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (group.active) return;
      await switchGroup(group.id);
      el.ccSection.classList.remove("open");
      el.codexSection.classList.remove("open");
      pulseArrow();
      await refresh();
    });
    el.groupTabs.appendChild(tab);
  });
}

async function switchGroup(groupId) {
  await postJson("/api/groups/switch", { groupId });
  await openBoundCodex();
}

async function openBoundCodex() {
  try {
    await postJson("/api/open-codex", {});
  } catch {
    // Some groups intentionally have no Codex thread yet.
  }
}

function findGroupForSelectedCc(snap) {
  const selectedTitle = normalizeTitle(snap?.view?.cc?.selectedTitle);
  const activeGroupId = snap?.view?.activeGroupId;
  if (!selectedTitle) return null;
  return (snap?.view?.groups || []).find((group) => (
    group.id !== activeGroupId && normalizeTitle(group.ccTitle) === selectedTitle
  )) || null;
}

/* ---- 动效 ---- */

function pulseArrow() {
  el.bridgeArrow.classList.add("active");
  setTimeout(() => el.bridgeArrow.classList.remove("active"), 700);
}

/* ---- 工具函数 ---- */

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function esc(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function normalizeTitle(text) {
  return String(text ?? "").trim().toLowerCase();
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}
