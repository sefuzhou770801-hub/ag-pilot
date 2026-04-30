import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getAntigravityStatus,
  isAntigravityTargetBusy,
  listAntigravityConversations,
  selectAntigravityConversation,
} from "./antigravity-client.mjs";
import { buildCardViewModel } from "./card-view-model.mjs";
import {
  createGroup,
  deleteGroup,
  getViewGroup,
  loadState,
  saveState,
  setViewGroup,
  updateViewGroup,
} from "./config.mjs";
import { defaultCodexSocketPath, openCodexThread } from "./codex-ipc-client.mjs";
import { findLatestCodexRollout, listRecentCodexThreads } from "./codex-session-log.mjs";
import { listCodexThreadsFromDb, getCodexThreadTitle } from "./codex-db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");

const defaultDependencies = {
  existsSync,
  readFile,
  stat,
  getAntigravityStatus,
  isAntigravityTargetBusy,
  listAntigravityConversations,
  selectAntigravityConversation,
  buildCardViewModel,
  createGroup,
  deleteGroup,
  getViewGroup,
  loadState,
  saveState,
  setViewGroup,
  updateViewGroup,
  defaultCodexSocketPath,
  openCodexThread,
  findLatestCodexRollout,
  listRecentCodexThreads,
  listCodexThreadsFromDb,
  getCodexThreadTitle,
  publicDir,
};

function resolveDependencies(overrides = {}) {
  return { ...defaultDependencies, ...overrides };
}

export function createBridgeServer(options = {}) {
  const dependencies = resolveDependencies(options.dependencies);
  return createServer(async (request, response) => {
    try {
      await route(request, response, dependencies);
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
  });
}

async function route(request, response, dependencies) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/") {
    return await sendFile(response, "index.html", "text/html; charset=utf-8", dependencies);
  }
  if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
    const assetName = url.pathname.replace("/assets/", "");
    const type = assetName.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
    return await sendFile(response, assetName, type, dependencies);
  }
  if (request.method === "GET" && url.pathname === "/api/snapshot") {
    return sendJson(response, 200, await snapshot(dependencies));
  }
  if (request.method === "GET" && url.pathname === "/api/codex-threads") {
    const result = await dependencies.listCodexThreadsFromDb();
    return sendJson(response, 200, result);
  }
  if (request.method === "POST" && url.pathname === "/api/groups/create") {
    const body = await readJson(request);
    const name = String(body.name ?? "").trim();
    const state = await dependencies.loadState();
    const { data, group } = dependencies.createGroup(state, name);
    await dependencies.saveState(data);
    return sendJson(response, 200, { ok: true, group, data });
  }
  if (request.method === "POST" && url.pathname === "/api/groups/delete") {
    const body = await readJson(request);
    const groupId = body.groupId;
    if (!groupId) return sendJson(response, 400, { ok: false, error: "Group id is required" });
    const state = await dependencies.loadState();
    const data = dependencies.deleteGroup(state, groupId);
    await dependencies.saveState(data);
    return sendJson(response, 200, { ok: true, data });
  }
  if (request.method === "POST" && url.pathname === "/api/groups/switch") {
    const body = await readJson(request);
    const groupId = body.groupId;
    if (!groupId) return sendJson(response, 400, { ok: false, error: "Group id is required" });
    const state = await dependencies.loadState();
    const data = dependencies.setViewGroup(state, groupId);
    await dependencies.saveState(data);
    const viewGroup = dependencies.getViewGroup(data);
    void selectBoundAntigravityConversation(viewGroup, dependencies);
    return sendJson(response, 200, { ok: true, data, antigravitySelection: { pending: true } });
  }
  if (request.method === "POST" && url.pathname === "/api/bind/cc") {
    const body = await readJson(request);
    const title = body.title;
    if (!title) return sendJson(response, 400, { ok: false, error: "CC title is required" });
    const state = await dependencies.loadState();
    const data = dependencies.updateViewGroup(state, { ccTitle: title });
    await dependencies.saveState(data);
    return sendJson(response, 200, { ok: true, data });
  }
  if (request.method === "POST" && url.pathname === "/api/bind/codex") {
    const body = await readJson(request);
    const threadId = body.threadId;
    if (!threadId) return sendJson(response, 400, { ok: false, error: "Codex thread is required" });
    const state = await dependencies.loadState();
    const data = dependencies.updateViewGroup(state, { codexThreadId: threadId });
    await dependencies.saveState(data);
    return sendJson(response, 200, { ok: true, data });
  }
  if (request.method === "POST" && url.pathname === "/api/bind/codex-recent") {
    const threads = await dependencies.listRecentCodexThreads();
    const threadId = threads[0]?.threadId;
    if (!threadId) return sendJson(response, 400, { ok: false, error: "No recent Codex thread found" });
    const state = await dependencies.loadState();
    const data = dependencies.updateViewGroup(state, { codexThreadId: threadId });
    await dependencies.saveState(data);
    return sendJson(response, 200, { ok: true, data });
  }
  if (request.method === "POST" && url.pathname === "/api/open-codex") {
    const state = await dependencies.loadState();
    const viewGroup = dependencies.getViewGroup(state);
    if (!viewGroup?.codexThreadId) return sendJson(response, 400, { ok: false, error: "Codex thread is not bound" });
    await dependencies.openCodexThread(viewGroup.codexThreadId);
    return sendJson(response, 200, { ok: true });
  }
  sendJson(response, 404, { ok: false, error: "Not found" });
}

async function selectBoundAntigravityConversation(group, dependencies = defaultDependencies) {
  if (!group?.ccTitle) return { ok: true, skipped: true };
  try {
    const result = await dependencies.selectAntigravityConversation({ title: group.ccTitle });
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function snapshot(overrides = {}) {
  const dependencies = resolveDependencies(overrides);
  let state = await dependencies.loadState();

  // 自动清除已结束但 codexBusy 仍为 true 的分组
  state = await autoClearStaleBusy(state, dependencies);

  const viewGroup = dependencies.getViewGroup(state);
  const viewState = {
    ...state,
    data: {
      ...state.data,
      activeGroupId: viewGroup?.id ?? state.data.activeGroupId,
    },
  };
  const antigravity = await dependencies.getAntigravityStatus().catch((error) => ({ error: error.message }));
  const socketPath = dependencies.defaultCodexSocketPath();
  const status = {
    antigravity,
    codex: {
      socketPath,
      socketExists: dependencies.existsSync(socketPath),
    },
  };
  const conversations = await dependencies.listAntigravityConversations().catch(() => []);
  const codexThreads = await dependencies.listRecentCodexThreads().catch(() => []);
  const codexDb = await dependencies.listCodexThreadsFromDb().catch(() => ({ ok: false, threads: [] }));
  const boundThreadTitle = viewGroup?.codexThreadId
    ? await dependencies.getCodexThreadTitle(viewGroup.codexThreadId).catch(() => null)
    : null;
  const antigravityBusy = await readAntigravityBusy(viewGroup, antigravity, dependencies);
  return {
    ok: true,
    state,
    groups: state.data.groups,
    activeGroupId: state.data.activeGroupId,
    viewGroupId: state.data.viewGroupId,
    status,
    conversations,
    codexThreads,
    codexDb,
    boundThreadTitle,
    view: dependencies.buildCardViewModel({ state: viewState, status, conversations, codexThreads, codexDb, boundThreadTitle, antigravityBusy }),
  };
}

async function readAntigravityBusy(viewGroup, antigravity, dependencies) {
  if (!viewGroup?.ccTitle || !antigravity?.cdp?.connected) {
    return { known: false, busy: null };
  }
  try {
    return { known: true, busy: await dependencies.isAntigravityTargetBusy() };
  } catch (error) {
    return { known: false, busy: null, error: error.message };
  }
}

async function sendFile(response, fileName, contentType, dependencies) {
  const fullPath = path.join(dependencies.publicDir, fileName);
  const body = await dependencies.readFile(fullPath);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data, null, 2));
}

const BUSY_STALE_THRESHOLD_MS = 30_000;

async function autoClearStaleBusy(state, dependencies = defaultDependencies) {
  const busyGroups = state.data.groups.filter((g) => g.codexBusy && g.codexThreadId);
  if (busyGroups.length === 0) return state;

  let changed = false;
  const updatedGroups = await Promise.all(
    state.data.groups.map(async (group) => {
      if (!group.codexBusy || !group.codexThreadId) return group;
      try {
        const rolloutPath = await dependencies.findLatestCodexRollout(group.codexThreadId);
        const fileStat = await dependencies.stat(rolloutPath);
        const age = Date.now() - fileStat.mtimeMs;
        if (age > BUSY_STALE_THRESHOLD_MS) {
          changed = true;
          return { ...group, codexBusy: false };
        }
      } catch {
        // rollout 文件找不到也意味着 Codex 已经结束
        changed = true;
        return { ...group, codexBusy: false };
      }
      return group;
    }),
  );

  if (!changed) return state;

  const newData = {
    ...state.data,
    groups: updatedGroups,
    updatedAt: new Date().toISOString(),
  };
  await dependencies.saveState(newData);
  return { ...state, data: newData };
}
