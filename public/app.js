/* ============================================================
   CC Codex Bridge — 卡片前端逻辑 V2
   只做状态确认 + 下拉绑定，没有发送按钮
   ============================================================ */

const $ = (id) => document.getElementById(id);

const el = {
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
  footerText: $("footerText"),
  footerTime: $("footerTime"),
};

let lastSnapshot = null;

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
setInterval(refresh, 3000);

/* ---- 核心逻辑 ---- */

async function refresh() {
  try {
    const res = await fetch("/api/snapshot", { cache: "no-store" });
    lastSnapshot = await res.json();
    render(lastSnapshot);
  } catch (err) {
    el.footerText.textContent = `连接失败`;
    el.safetyBanner.className = "safety danger";
    el.safetyText.textContent = "桥接器未响应";
  }
}

function render(snap) {
  const v = snap.view;
  const convs = snap.conversations || [];

  // ---- CC 节点 ----
  const ccDisplayName = v.cc.boundTitle || v.cc.selectedTitle;
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
      await postJson("/api/bind/cc", { title: conv.title });
      el.ccSection.classList.remove("open");
      pulseArrow();
      await refresh();
    });
    el.ccList.appendChild(item);
  });

  // ---- Codex 节点 ----
  const codexTitle = v.codex.boundTitle || v.codex.latestTitle;
  if (v.codex.boundTitle) {
    el.codexName.textContent = v.codex.boundTitle;
    el.codexStatus.textContent = "✓";
    el.codexStatus.className = "node-status";
  } else if (v.codex.latestTitle) {
    el.codexName.textContent = v.codex.latestTitle;
    el.codexStatus.textContent = "点击绑定";
    el.codexStatus.className = "node-status unbound";
  } else {
    el.codexName.textContent = "未检测到对话";
    el.codexStatus.textContent = "";
    el.codexStatus.className = "node-status warning";
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
      await postJson("/api/bind/codex", { threadId: thread.threadId });
      el.codexSection.classList.remove("open");
      pulseArrow();
      await refresh();
    });
    el.codexList.appendChild(item);
  });

  // ---- 安全状态 ----
  const risk = v.risk;
  el.safetyBanner.className = `safety ${risk.level}`;
  if (risk.level === "ok") {
    el.safetyText.textContent = "双向通道就绪";
  } else if (risk.level === "warning") {
    el.safetyText.textContent = risk.message;
  } else {
    el.safetyText.textContent = risk.message;
  }

  // ---- 底部 ----
  el.footerText.textContent = v.bridge.cdpConnected ? "周瑟夫" : "未连接";
  el.footerTime.textContent = new Date(v.generatedAt).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
  return await res.json();
}

function esc(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
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
