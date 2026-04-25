import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_CODEX_SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions");

export async function findLatestCodexRollout(threadId, sessionsRoot = DEFAULT_CODEX_SESSIONS_ROOT) {
  if (!threadId) throw new Error("Codex thread id is required");
  const matches = [];

  for await (const filePath of walkFiles(sessionsRoot)) {
    const base = path.basename(filePath);
    if (!base.endsWith(".jsonl")) continue;
    if (!base.includes(threadId)) continue;
    const fileStat = await stat(filePath);
    matches.push({ path: filePath, mtimeMs: fileStat.mtimeMs });
  }

  matches.sort((a, b) => b.mtimeMs - a.mtimeMs || b.path.localeCompare(a.path));
  if (!matches[0]) {
    throw new Error(`No Codex rollout found for thread ${threadId}`);
  }
  return matches[0].path;
}

export async function listRecentCodexThreads(sessionsRoot = DEFAULT_CODEX_SESSIONS_ROOT, limit = 6) {
  const files = [];
  for await (const filePath of walkFiles(sessionsRoot)) {
    const base = path.basename(filePath);
    if (!base.startsWith("rollout-") || !base.endsWith(".jsonl")) continue;
    const threadId = extractThreadId(base);
    if (!threadId) continue;
    const fileStat = await stat(filePath);
    files.push({ threadId, rolloutPath: filePath, mtimeMs: fileStat.mtimeMs });
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs || b.rolloutPath.localeCompare(a.rolloutPath));
  const seen = new Set();
  const unique = [];
  for (const file of files) {
    if (seen.has(file.threadId)) continue;
    seen.add(file.threadId);
    unique.push({
      threadId: file.threadId,
      threadShort: shortenThreadId(file.threadId),
      rolloutPath: file.rolloutPath,
      updatedAt: new Date(file.mtimeMs).toISOString(),
    });
    if (unique.length >= limit) break;
  }
  return unique;
}

export async function readLatestAssistantReply(rolloutPath) {
  const raw = await readFile(rolloutPath, "utf8");
  let latest = null;
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = item.payload;
    if (item.type !== "response_item") continue;
    if (payload?.type !== "message") continue;
    if (payload.role !== "assistant") continue;

    const text = extractMessageText(payload.content);
    if (!text) continue;
    latest = {
      text,
      line: index + 1,
      timestamp: item.timestamp ?? null,
      rolloutPath,
    };
  }

  if (!latest) {
    throw new Error(`No assistant reply found in ${rolloutPath}`);
  }
  return latest;
}

export async function readLatestAssistantReplyForThread(threadId, sessionsRoot = DEFAULT_CODEX_SESSIONS_ROOT) {
  const rolloutPath = await findLatestCodexRollout(threadId, sessionsRoot);
  return await readLatestAssistantReply(rolloutPath);
}

export function extractThreadIdFromRolloutPath(rolloutPath) {
  return extractThreadId(path.basename(String(rolloutPath ?? "")));
}

function extractMessageText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && (part.type === "output_text" || part.type === "text"))
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

function extractThreadId(fileName) {
  const match = fileName.match(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/);
  return match?.[1] ?? null;
}

function shortenThreadId(threadId) {
  if (!threadId) return "";
  if (threadId.length <= 18) return threadId;
  return `${threadId.slice(0, 8)}...${threadId.slice(-5)}`;
}

async function* walkFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath);
    } else if (entry.isFile()) {
      yield entryPath;
    }
  }
}
