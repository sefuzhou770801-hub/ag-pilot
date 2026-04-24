#!/usr/bin/env node
import { existsSync } from "node:fs";

import {
  getAutoAcceptStatus,
  listAutoAcceptConversations,
  readLatestAntigravityReply,
  sendTextToAntigravity,
} from "./lib/autoaccept-adapter.mjs";
import { loadState, saveState } from "./lib/config.mjs";
import {
  openCodexThread,
  probeCodexThread,
  sendToCodexThread,
  defaultCodexSocketPath,
} from "./lib/codex-ipc-client.mjs";
import { readLatestAssistantReplyForThread } from "./lib/codex-session-log.mjs";

const args = process.argv.slice(2);
const command = args.shift();
const flags = parseFlags(args);

try {
  const result = await run(command, flags);
  printResult(result, flags.json);
} catch (error) {
  if (flags.json) {
    console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
  } else {
    console.error(error.message);
  }
  process.exit(1);
}

async function run(cmd, flags) {
  if (!cmd || cmd === "help" || cmd === "--help") return help();

  if (cmd === "status") {
    const state = await loadState();
    const autoAccept = await getAutoAcceptStatus().catch((error) => ({ error: error.message }));
    const socketPath = defaultCodexSocketPath();
    return {
      ok: true,
      state,
      autoAccept,
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
    const data = { ...state.data, codexThreadId: threadId, updatedAt: new Date().toISOString() };
    const path = await saveState(data);
    return { ok: true, path, data };
  }

  if (cmd === "bind-cc") {
    const title = flags.title ?? flags._.join(" ").trim();
    if (!title) throw new Error("Usage: bind-cc --title <Antigravity conversation title>");
    const state = await loadState();
    const data = { ...state.data, ccTitle: title, updatedAt: new Date().toISOString() };
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
    const threadId = await requireThreadId(flags);
    return { ok: true, threadId, reply: await readLatestAssistantReplyForThread(threadId) };
  }

  if (cmd === "codex-send") {
    const threadId = await requireThreadId(flags);
    const text = flags.text ?? flags._.join(" ").trim();
    return await sendToCodexThread(threadId, text, { waitMs: flags.waitMs });
  }

  if (cmd === "ag-list") {
    return { ok: true, conversations: await listAutoAcceptConversations() };
  }

  if (cmd === "ag-latest") {
    const title = await requireCcTitle(flags, false);
    return { ok: true, reply: await readLatestAntigravityReply({ title }) };
  }

  if (cmd === "ag-send") {
    const title = await requireCcTitle(flags);
    const text = flags.text ?? flags._.join(" ").trim();
    return { ok: true, result: await sendTextToAntigravity({ title, text }) };
  }

  if (cmd === "cc-to-codex") {
    const threadId = await requireThreadId(flags);
    const title = await requireCcTitle(flags);
    const reply = await readLatestAntigravityReply({ title });
    if (flags.dryRun) {
      return { ok: true, dryRun: true, direction: "cc-to-codex", source: reply, targetThreadId: threadId };
    }
    const sent = await sendToCodexThread(threadId, reply.text, { waitMs: flags.waitMs });
    return { ok: sent.ok, direction: "cc-to-codex", source: reply, codex: sent };
  }

  if (cmd === "codex-to-cc") {
    const threadId = await requireThreadId(flags);
    const title = await requireCcTitle(flags);
    const reply = await readLatestAssistantReplyForThread(threadId);
    if (flags.dryRun) {
      return { ok: true, dryRun: true, direction: "codex-to-cc", source: reply, targetTitle: title };
    }
    const sent = await sendTextToAntigravity({ title, text: reply.text });
    return { ok: true, direction: "codex-to-cc", source: reply, antigravity: sent };
  }

  throw new Error(`Unknown command: ${cmd}`);
}

async function requireThreadId(flags) {
  if (flags.thread) return flags.thread;
  if (flags._[0] && flags._[0].startsWith("019")) return flags._.shift();
  const state = await loadState();
  if (state.data.codexThreadId) return state.data.codexThreadId;
  throw new Error("Codex thread is not bound. Run bind-codex <threadId> first.");
}

async function requireCcTitle(flags, required = true) {
  if (flags.title) return flags.title;
  const state = await loadState();
  if (state.data.ccTitle) return state.data.ccTitle;
  if (!required) return undefined;
  throw new Error("CC conversation is not bound. Run bind-cc --title <title> first.");
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

function help() {
  return {
    usage: [
      "node tools/cc-codex-bridge/bridge.mjs status --json",
      "node tools/cc-codex-bridge/bridge.mjs bind-codex <threadId>",
      "node tools/cc-codex-bridge/bridge.mjs bind-cc --title <title>",
      "node tools/cc-codex-bridge/bridge.mjs cc-to-codex --dry-run",
      "node tools/cc-codex-bridge/bridge.mjs codex-to-cc --dry-run",
    ].join("\n"),
  };
}
