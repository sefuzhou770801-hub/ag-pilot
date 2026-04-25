#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getAntigravityStatus,
  listAntigravityConversations,
  readLatestAntigravityReply,
  sendTextToAntigravity,
} from "./lib/antigravity-client.mjs";
import { findGroup, getViewGroup, loadState, saveState, updateGroup, updateViewGroup } from "./lib/config.mjs";
import {
  openCodexThread,
  probeCodexThread,
  sendToCodexThread,
  defaultCodexSocketPath,
} from "./lib/codex-ipc-client.mjs";
import { readLatestAssistantReplyForThread } from "./lib/codex-session-log.mjs";

if (isCliEntrypoint()) {
  const args = process.argv.slice(2);
  const command = args.shift();
  const flags = parseFlags(args);

  try {
    const result = await run(command, flags);
    printResult(result, flags.json);
  } catch (error) {
    if (flags.json) {
      const payload = { ok: false, error: error.message };
      if (error.retried) payload.retried = true;
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}

export async function run(cmd, flags) {
  if (!cmd || cmd === "help" || cmd === "--help") return help();

  if (cmd === "status") {
    const state = await loadState();
    const defaultGroup = getViewGroup(state);
    const antigravity = await getAntigravityStatus().catch((error) => ({ error: error.message }));
    const socketPath = defaultCodexSocketPath();
    return {
      ok: true,
      state,
      routing: {
        defaultGroupId: defaultGroup?.id ?? "",
        defaultGroupName: defaultGroup?.name ?? "",
        ccTitle: defaultGroup?.ccTitle ?? "",
        codexThreadId: defaultGroup?.codexThreadId ?? "",
      },
      antigravity,
      codex: {
        socketPath,
        socketExists: existsSync(socketPath),
      },
    };
  }

  if (cmd === "bind-codex") {
    const threadId = flags._[0];
    if (!threadId) throw new Error("Usage: bind-codex <threadId>");
    const state = await loadState();
    const data = updateViewGroup(state, { codexThreadId: threadId });
    const path = await saveState(data);
    return { ok: true, path, data };
  }

  if (cmd === "bind-cc") {
    const title = flags.title ?? flags._.join(" ").trim();
    if (!title) throw new Error("Usage: bind-cc --title <Antigravity conversation title>");
    const state = await loadState();
    const data = updateViewGroup(state, { ccTitle: title });
    const path = await saveState(data);
    return { ok: true, path, data };
  }

  if (cmd === "open-codex") {
    const threadId = await requireThreadId(flags);
    await openCodexThread(threadId);
    return { ok: true, opened: `codex://threads/${threadId}` };
  }

  if (cmd === "codex-probe") {
    const threadId = await requireThreadId(flags);
    return await probeCodexThread(threadId, { waitMs: flags.waitMs });
  }

  if (cmd === "codex-latest") {
    const route = await requireThreadRoute(flags);
    return { ok: true, threadId: route.threadId, reply: await readLatestAssistantReplyForThread(route.threadId) };
  }

  if (cmd === "codex-send") {
    const route = await requireThreadRoute(flags);
    const text = flags.text ?? flags._.join(" ").trim();
    const result = await sendToCodexThread(route.threadId, text, { waitMs: flags.waitMs });
    if (result.ok) await setCodexBusy(route.group?.id, true);
    return result;
  }

  if (cmd === "ag-list") {
    return { ok: true, conversations: await listAntigravityConversations() };
  }

  if (cmd === "ag-latest") {
    const title = await requireCcTitle(flags, false);
    return { ok: true, reply: await readLatestAntigravityReply({ title }) };
  }

  if (cmd === "ag-send") {
    const route = await requireCcRoute(flags);
    const text = flags.text ?? flags._.join(" ").trim();
    const result = await sendTextToAntigravityWithRetry({ title: route.title, text });
    if (result.sent) await setCodexBusy(route.group?.id, false);
    return { ok: true, retried: result.retried, result };
  }

  if (cmd === "cc-to-codex") {
    const threadRoute = await requireThreadRoute(flags);
    const title = await requireCcTitle(flags);
    const reply = await readLatestAntigravityReply({ title });
    if (flags.dryRun) {
      return { ok: true, dryRun: true, direction: "cc-to-codex", source: reply, targetThreadId: threadRoute.threadId };
    }
    const sent = await sendToCodexThread(threadRoute.threadId, reply.text, { waitMs: flags.waitMs });
    if (sent.ok) await setCodexBusy(threadRoute.group?.id, true);
    return { ok: sent.ok, direction: "cc-to-codex", source: reply, codex: sent };
  }

  if (cmd === "codex-to-cc") {
    const threadRoute = await requireThreadRoute(flags);
    const ccRoute = await requireCcRoute(flags);
    const reply = await readLatestAssistantReplyForThread(threadRoute.threadId);
    if (flags.dryRun) {
      return { ok: true, dryRun: true, direction: "codex-to-cc", source: reply, targetTitle: ccRoute.title };
    }
    const sent = await sendTextToAntigravity({ title: ccRoute.title, text: reply.text });
    await setCodexBusy(threadRoute.group?.id ?? ccRoute.group?.id, false);
    return { ok: true, direction: "codex-to-cc", source: reply, antigravity: sent };
  }

  throw new Error(`Unknown command: ${cmd}`);
}

export async function sendTextToAntigravityWithRetry(options = {}, retryOptions = {}) {
  const sender = retryOptions.sender ?? sendTextToAntigravity;
  const waitMs = retryOptions.waitMs ?? 3000;
  try {
    return { ...(await sender(options)), retried: false };
  } catch (firstError) {
    await sleep(waitMs);
    try {
      return { ...(await sender(options)), retried: true };
    } catch (secondError) {
      secondError.retried = true;
      secondError.message = `${secondError.message} (first attempt also failed: ${firstError.message})`;
      throw secondError;
    }
  }
}

export function resolveRoutingGroup(state, flags = {}) {
  if (flags.group) {
    const group = findGroup(state, flags.group);
    if (!group) throw new Error(`Group not found: ${flags.group}`);
    return group;
  }
  return getViewGroup(state);
}

async function requireThreadId(flags) {
  return (await requireThreadRoute(flags)).threadId;
}

async function requireThreadRoute(flags) {
  if (flags.thread) return { threadId: flags.thread, group: null };
  if (flags._[0] && flags._[0].startsWith("019")) {
    return { threadId: flags._.shift(), group: null };
  }
  const state = await loadState();
  const group = resolveRoutingGroup(state, flags);
  if (group?.codexThreadId) return { threadId: group.codexThreadId, group };
  if (group?.name) throw new Error(`Codex thread is not bound for group: ${group.name}`);
  throw new Error("Codex thread is not bound. Run bind-codex <threadId> first.");
}

async function requireCcTitle(flags, required = true) {
  return (await requireCcRoute(flags, required)).title;
}

async function requireCcRoute(flags, required = true) {
  if (flags.title) return { title: flags.title, group: null };
  const state = await loadState();
  const group = resolveRoutingGroup(state, flags);
  if (group?.ccTitle) return { title: group.ccTitle, group };
  if (!required) return { title: undefined, group };
  if (group?.name) throw new Error(`CC conversation is not bound for group: ${group.name}`);
  throw new Error("CC conversation is not bound. Run bind-cc --title <title> first.");
}

async function setCodexBusy(groupId, codexBusy) {
  if (!groupId) return;
  const state = await loadState();
  const data = updateGroup(state, groupId, { codexBusy });
  await saveState(data);
}

function parseFlags(values) {
  const parsed = { _: [] };
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === "--json") {
      parsed.json = true;
    } else if (value === "--thread") {
      parsed.thread = values[++i];
    } else if (value === "--title") {
      parsed.title = values[++i];
    } else if (value === "--group") {
      parsed.group = values[++i];
    } else if (value === "--text") {
      parsed.text = values[++i];
    } else if (value === "--wait-ms") {
      parsed.waitMs = Number(values[++i]);
    } else if (value === "--dry-run") {
      parsed.dryRun = true;
    } else {
      parsed._.push(value);
    }
  }
  return parsed;
}

function printResult(result, json) {
  if (json || typeof result !== "object") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.usage) {
    console.log(result.usage);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCliEntrypoint() {
  if (!process.argv[1]) return false;
  return realPath(process.argv[1]) === realPath(fileURLToPath(import.meta.url));
}

function realPath(filePath) {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function help() {
  return {
    usage: [
      "node tools/cc-codex-bridge/bridge.mjs status --json",
      "node tools/cc-codex-bridge/bridge.mjs bind-codex <threadId>",
      "node tools/cc-codex-bridge/bridge.mjs bind-cc --title <title>",
      "node tools/cc-codex-bridge/bridge.mjs codex-send --group <name-or-id> --text <text>",
      "node tools/cc-codex-bridge/bridge.mjs ag-send --group <name-or-id> --text <text>",
      "node tools/cc-codex-bridge/bridge.mjs cc-to-codex --dry-run",
      "node tools/cc-codex-bridge/bridge.mjs codex-to-cc --dry-run",
    ].join("\n"),
  };
}
