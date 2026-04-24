import { readBridgeConfig } from "./config.mjs";
import { CdpClient } from "./cdp-client.mjs";

const LOCALHOST = "127.0.0.1";

export async function getAntigravityStatus(options = {}) {
  const config = await readBridgeConfig(options);
  const targets = await listCdpTargets(config.cdpPort).catch(() => null);
  return {
    config,
    cdp: {
      host: LOCALHOST,
      port: config.cdpPort,
      connected: Array.isArray(targets),
      targetCount: Array.isArray(targets) ? targets.length : 0,
    },
  };
}

export async function listCdpTargets(port = 9333) {
  const response = await fetch(`http://${LOCALHOST}:${port}/json/list`);
  if (!response.ok) throw new Error(`Antigravity CDP returned HTTP ${response.status}`);
  return await response.json();
}

export async function listAntigravityConversations(options = {}) {
  const config = await readBridgeConfig(options);
  const targets = await listCdpTargets(options.port ?? config.cdpPort);
  const manager = findManagerTarget(targets);
  if (!manager) return [];

  const client = new CdpClient(manager.webSocketDebuggerUrl);
  try {
    const raw = await client.evaluate(managerConversationScript());
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } finally {
    client.close();
  }
}

export async function readLatestAntigravityReply(options = {}) {
  const target = await resolveTarget(options);
  const client = new CdpClient(target.webSocketDebuggerUrl);
  try {
    const text = await client.evaluate(latestAssistantTextScript());
    if (!text) throw new Error("No CC assistant reply found in the selected Antigravity target");
    return { text, targetTitle: target.title ?? "", targetId: target.id ?? "" };
  } finally {
    client.close();
  }
}

export async function sendTextToAntigravity(options = {}) {
  if (!options.text) throw new Error("Message text is required");
  const target = await resolveTarget(options);
  const client = new CdpClient(target.webSocketDebuggerUrl);
  try {
    const focusResult = await client.evaluate(focusInputScript());
    if (focusResult !== "ready") {
      throw new Error(`CC input is not ready in target "${target.title ?? target.id}"`);
    }
    await client.insertText(options.text);
    await client.pressEnter();
    return { sent: true, targetTitle: target.title ?? "", targetId: target.id ?? "" };
  } finally {
    client.close();
  }
}

export async function isAntigravityTargetBusy(options = {}) {
  const target = await resolveTarget(options);
  const client = new CdpClient(target.webSocketDebuggerUrl);
  try {
    return Boolean(await client.evaluate(agentBusyScript()));
  } finally {
    client.close();
  }
}

async function resolveTarget(options) {
  const config = await readBridgeConfig(options);
  const targets = await listCdpTargets(options.port ?? config.cdpPort);
  let target = options.title ? findTargetByTitle(targets, options.title) : findCurrentChatTarget(targets);
  if (!target && options.title) {
    target = await findSelectedManagerTarget(targets, options.title);
  }
  if (!target) {
    const hint = options.title ? `title "${options.title}"` : "current chat target";
    throw new Error(`No Antigravity target found for ${hint}`);
  }
  if (!target.webSocketDebuggerUrl) throw new Error(`Antigravity target has no CDP socket: ${target.title}`);
  return target;
}

export function findTargetByTitle(targets, title) {
  const needle = String(title ?? "").trim().toLowerCase();
  if (!needle) return null;
  return candidateTargets(targets).find((target) => {
    const hay = String(target.title ?? "").toLowerCase();
    return hay.includes(needle) || needle.includes(hay.slice(0, 20));
  }) ?? null;
}

export function findManagerTarget(targets) {
  return candidateTargets(targets).find((target) => {
    const title = String(target.title ?? "").toLowerCase();
    const url = String(target.url ?? "");
    return title === "manager" || title === "launchpad" || url.includes("jetski-agent");
  }) ?? null;
}

export function findCurrentChatTarget(targets) {
  const candidates = candidateTargets(targets);
  return candidates.find((target) => {
    const title = String(target.title ?? "").toLowerCase();
    const url = String(target.url ?? "");
    if (title === "manager" || title === "launchpad") return false;
    return url.startsWith("vscode-file://") || url.includes("vscode-webview");
  }) ?? findManagerTarget(candidates);
}

async function findSelectedManagerTarget(targets, title) {
  const manager = findManagerTarget(targets);
  if (!manager) return null;
  const client = new CdpClient(manager.webSocketDebuggerUrl);
  try {
    const raw = await client.evaluate(managerConversationScript());
    const conversations = JSON.parse(raw || "[]");
    const needle = String(title).trim().toLowerCase();
    const selected = conversations.find((item) => {
      const itemTitle = String(item.title ?? "").trim().toLowerCase();
      return item.selected && (itemTitle.includes(needle) || needle.includes(itemTitle));
    });
    return selected ? manager : null;
  } catch {
    return null;
  } finally {
    client.close();
  }
}

function candidateTargets(targets) {
  return (targets ?? []).filter((target) => {
    if (!target?.webSocketDebuggerUrl) return false;
    if (target.type !== "page" && target.type !== "iframe") return false;
    const url = String(target.url ?? "");
    if (!url) return false;
    if (url.startsWith("http://") || url.startsWith("https://")) return false;
    return true;
  });
}

function focusInputScript() {
  return `(() => {
    const panel = document.querySelector('.antigravity-agent-side-panel');
    const scope = panel || document;
    const input = scope.querySelector('[contenteditable="true"][role="textbox"]:not(.xterm-helper-textarea)');
    if (input && input.offsetParent !== null) {
      input.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);
      return 'ready';
    }
    return 'not-found';
  })()`;
}

function agentBusyScript() {
  return `(() => {
    const panel = document.querySelector('.antigravity-agent-side-panel') || document;
    const stopBtn = panel.querySelector('button[aria-label*="stop"], button[aria-label*="Stop"], [class*="stop"]');
    const progress = panel.querySelector('[class*="progress_activity"], [class*="animate-spin"]');
    return !!(stopBtn || progress);
  })()`;
}

function latestAssistantTextScript() {
  return `(() => {
    function isVisible(el) { return el && el.offsetParent !== null; }
    const assistantSelectors = [
      '[data-message-author-role="assistant"]',
      '[data-message-role="assistant"]',
      '.rendered-markdown:not([data-message-author-role="user"]):not([data-message-role="user"])',
      '[class*="markdown-body"]:not([data-message-author-role="user"]):not([data-message-role="user"])',
      '.prose:not([data-message-author-role="user"]):not([data-message-role="user"])',
      '.leading-relaxed.select-text'
    ];
    const scopeSelectors = [
      '.antigravity-agent-side-panel',
      '#conversation',
      'div[class*="w-full"][class*="flex"][class*="h-full"][class*="overflow-y-auto"]'
    ];
    const thinkingSelector = 'details, [class*="thinking"], [class*="thought"], [class*="reasoning"], [class*="collapsed"], [class*="collapsible"], [data-type="thinking"], [data-type="thought"]';
    const chromeSelector = 'button, [role="button"], .material-icons, .codicon, svg, [class*="action"], span.hidden, style, link[rel="stylesheet"]';

    const scopes = scopeSelectors.map((selector) => document.querySelector(selector)).filter(isVisible);
    scopes.push(document.body);

    let node = null;
    for (const scope of scopes) {
      for (const selector of assistantSelectors) {
        const nodes = Array.from(scope.querySelectorAll(selector)).filter(isVisible);
        if (nodes.length > 0) node = nodes[nodes.length - 1];
      }
      if (node) break;
    }
    if (!node) return '';

    const clone = node.cloneNode(true);
    clone.querySelectorAll(chromeSelector).forEach((el) => el.remove());
    clone.querySelectorAll(thinkingSelector).forEach((el) => el.remove());
    let text = (clone.innerText || clone.textContent || '').trim();
    text = text.replace(/^(Thinking\\.{3}|Thought for \\d+[ms\\s]+seconds?)\\s*/gi, '');
    return text.replace(/(alternate_email|content_copy|more_vert|archive|fork_right|edit|delete|refresh)/g, '').trim();
  })()`;
}

function managerConversationScript() {
  return `(() => {
    const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim();
    const iconWords = new Set(['chevron_right', 'chevron_left', 'more_vert', 'add', 'keep', 'archive']);
    const stripIconText = (text) => clean(text).replace(/chevron_right|chevron_left|more_vertadd|more_vert|archive|keep|add/g, ' ').replace(/\\s+/g, ' ').trim();
    const cardName = (card) => {
      const lines = (card.innerText || card.textContent || '').split(/\\n+/)
        .map(stripIconText)
        .filter(Boolean)
        .filter(line => !iconWords.has(line.toLowerCase()));
      return lines[0] || 'Workspace';
    };
    const convos = [];
    const seen = new Set();
    let domIndex = 0;
    const addConvo = (title, workspace, item, index) => {
      title = clean(title);
      workspace = clean(workspace) || 'Workspace';
      if (!title) return;
      const key = workspace + '\\n' + title;
      if (seen.has(key)) return;
      seen.add(key);
      const itemText = clean(item && (item.innerText || item.textContent));
      const markerText = stripIconText(itemText).toLowerCase();
      const hasStop = item && item.querySelector('[aria-label*="Stop"], [data-tooltip-id*="cancel"], [data-tooltip-id*="stop"]');
      const running = !!hasStop || /\\b(stop|running|generating|thinking)\\b/i.test(itemText);
      const selected = !!(item && typeof item.className === 'string' && item.className.includes('bg-list-hover'));
      const timeMatch = itemText.match(/(\\d+)\\s*(m|h|d)\\b/i);
      const recentMinutes = timeMatch && timeMatch[2].toLowerCase() === 'm' ? Number(timeMatch[1]) : null;
      const recent = /(^|\\s)now($|\\s)/i.test(markerText) || (Number.isFinite(recentMinutes) && recentMinutes <= 60);
      if (!running && !selected && !recent) return;
      const status = running ? 'running' : (selected ? 'active' : (recent ? 'recent' : 'idle'));
      convos.push({ title, workspace, status, selected, running, recent, active: true, domIndex: index });
    };

    const workspaceCards = document.querySelectorAll('[data-workspace-card="true"]');
    for (const card of workspaceCards) {
      const workspace = cardName(card);
      const container = card.nextElementSibling;
      if (!container) continue;
      const pills = container.querySelectorAll('[data-testid*="convo-pill"]');
      for (const pill of pills) {
        const item = pill.closest('div[role="button"], div[class*="select-none"][class*="cursor-pointer"][class*="rounded-md"]') || pill.parentElement;
        addConvo(pill.innerText || pill.textContent, workspace, item, domIndex++);
      }
    }

    if (convos.length === 0) {
      const pills = document.querySelectorAll('[data-testid*="convo-pill"]');
      domIndex = 0;
      for (const pill of pills) {
        const item = pill.closest('div[role="button"], div[class*="select-none"][class*="cursor-pointer"][class*="rounded-md"]') || pill.parentElement;
        addConvo(pill.innerText || pill.textContent, 'Manager', item, domIndex++);
      }
    }
    return JSON.stringify(convos);
  })()`;
}
