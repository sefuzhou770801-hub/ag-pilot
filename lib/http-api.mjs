import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getAutoAcceptStatus,
  listAutoAcceptConversations,
} from "./autoaccept-adapter.mjs";
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
import { listRecentCodexThreads } from "./codex-session-log.mjs";
import { listCodexThreadsFromDb, getCodexThreadTitle } from "./codex-db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");

export function createBridgeServer() {
  return createServer(async (request, response) => {
    try {
      await route(request, response);
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
  });
}

async function route(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/") {
    return await sendFile(response, "index.html", "text/html; charset=utf-8");
  }
  if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
    const assetName = url.pathname.replace("/assets/", "");
    const type = assetName.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
    return await sendFile(response, assetName, type);
  }
  if (request.method === "GET" && url.pathname === "/api/snapshot") {
    return sendJson(response, 200, await snapshot());
  }
  if (request.method === "GET" && url.pathname === "/api/codex-threads") {
    const result = await listCodexThreadsFromDb();
    return sendJson(response, 200, result);
  }
  if (request.method === "POST" && url.pathname === "/api/groups/create") {
    const body = await readJson(request);
    const name = String(body.name ?? "").trim();
    const state = await loadState();
    const { data, group } = createGroup(state, name);
    await saveState(data);
    return sendJson(response, 200, { ok: true, group, data });
  }
  if (request.method === "POST" && url.pathname === "/api/groups/delete") {
    const body = await readJson(request);
    const groupId = body.groupId;
    if (!groupId) return sendJson(response, 400, { ok: false, error: "Group id is required" });
    const state = await loadState();
    const data = deleteGroup(state, groupId);
    await saveState(data);
    return sendJson(response, 200, { ok: true, data });
  }
  if (request.method === "POST" && url.pathname === "/api/groups/switch") {
    const body = await readJson(request);
    const groupId = body.groupId;
    if (!groupId) return sendJson(response, 400, { ok: false, error: "Group id is required" });
    const state = await loadState();
    const data = setViewGroup(state, groupId);
    await saveState(data);
    return sendJson(response, 200, { ok: true, data });
  }
  if (request.method === "POST" && url.pathname === "/api/bind/cc") {
    const body = await readJson(request);
    const title = body.title;
    if (!title) return sendJson(response, 400, { ok: false, error: "CC title is required" });
    const state = await loadState();
    const data = updateViewGroup(state, { ccTitle: title });
    await saveState(data);
    return sendJson(response, 200, { ok: true, data });
  }
  if (request.method === "POST" && url.pathname === "/api/bind/codex") {
    const body = await readJson(request);
    const threadId = body.threadId;
    if (!threadId) return sendJson(response, 400, { ok: false, error: "Codex thread is required" });
    const state = await loadState();
    const data = updateViewGroup(state, { codexThreadId: threadId });
    await saveState(data);
    return sendJson(response, 200, { ok: true, data });
  }
  if (request.method === "POST" && url.pathname === "/api/bind/codex-recent") {
    const threads = await listRecentCodexThreads();
    const threadId = threads[0]?.threadId;
    if (!threadId) return sendJson(response, 400, { ok: false, error: "No recent Codex thread found" });
    const state = await loadState();
    const data = updateViewGroup(state, { codexThreadId: threadId });
    await saveState(data);
    return sendJson(response, 200, { ok: true, data });
  }
  if (request.method === "POST" && url.pathname === "/api/open-codex") {
    const state = await loadState();
    const viewGroup = getViewGroup(state);
    if (!viewGroup?.codexThreadId) return sendJson(response, 400, { ok: false, error: "Codex thread is not bound" });
    await openCodexThread(viewGroup.codexThreadId);
    return sendJson(response, 200, { ok: true });
  }
  sendJson(response, 404, { ok: false, error: "Not found" });
}

export async function snapshot() {
  const state = await loadState();
  const viewGroup = getViewGroup(state);
  const viewState = {
    ...state,
    data: {
      ...state.data,
      activeGroupId: viewGroup?.id ?? state.data.activeGroupId,
    },
  };
  const autoAccept = await getAutoAcceptStatus().catch((error) => ({ error: error.message }));
  const socketPath = defaultCodexSocketPath();
  const status = {
    autoAccept,
    codex: {
      socketPath,
      socketExists: existsSync(socketPath),
    },
  };
  const conversations = await listAutoAcceptConversations().catch(() => []);
  const codexThreads = await listRecentCodexThreads().catch(() => []);
  const codexDb = await listCodexThreadsFromDb().catch(() => ({ ok: false, threads: [] }));
  const boundThreadTitle = viewGroup?.codexThreadId
    ? await getCodexThreadTitle(viewGroup.codexThreadId).catch(() => null)
    : null;
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
    view: buildCardViewModel({ state: viewState, status, conversations, codexThreads, codexDb, boundThreadTitle }),
  };
}

async function sendFile(response, fileName, contentType) {
  const fullPath = path.join(publicDir, fileName);
  const body = await readFile(fullPath);
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
