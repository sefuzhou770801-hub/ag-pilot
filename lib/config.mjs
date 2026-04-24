import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_AUTOACCEPT_EXTENSIONS_ROOT = path.join(
  os.homedir(),
  ".antigravity",
  "extensions",
);

export const DEFAULT_ANTIGRAVITY_SETTINGS_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Antigravity",
  "User",
  "settings.json",
);

export const DEFAULT_CODEX_SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions");

export function statePathFor(options = {}) {
  if (options.statePath) return options.statePath;
  return path.join(
    options.homeDir ?? os.homedir(),
    ".gemini",
    "tools",
    "cc-codex-bridge",
    "state.json",
  );
}

export async function findLatestAutoAcceptExtension(root = DEFAULT_AUTOACCEPT_EXTENSIONS_ROOT) {
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith("yazanbaker.antigravity-autoaccept-")) continue;
    const extensionPath = path.join(root, entry.name);
    const packagePath = path.join(extensionPath, "package.json");
    try {
      const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
      const packageStat = await stat(packagePath);
      candidates.push({
        path: extensionPath,
        packagePath,
        version: String(packageJson.version ?? entry.name.replace(/^.*-/, "")),
        mtimeMs: packageStat.mtimeMs,
      });
    } catch {
      candidates.push({
        path: extensionPath,
        packagePath,
        version: entry.name.replace(/^.*-/, ""),
        mtimeMs: 0,
      });
    }
  }

  candidates.sort((a, b) => compareVersions(b.version, a.version) || b.mtimeMs - a.mtimeMs);
  if (!candidates[0]) {
    throw new Error(`AutoAccept plugin not found under ${root}`);
  }
  return candidates[0];
}

export async function readAutoAcceptSettings(settingsPath = DEFAULT_ANTIGRAVITY_SETTINGS_PATH) {
  let data = {};
  try {
    data = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch {
    data = {};
  }

  const cdpPort = Number(data["autoAcceptV2.cdpPort"] ?? 9333);
  return {
    path: settingsPath,
    cdpPort: Number.isFinite(cdpPort) && cdpPort > 0 ? cdpPort : 9333,
    hasProLicense: Boolean(data["autoAcceptV2.proLicenseKey"]),
  };
}

export async function loadState(options = {}) {
  const targetPath = statePathFor(options);
  let raw = {};
  let shouldPersist = false;
  try {
    raw = JSON.parse(await readFile(targetPath, "utf8"));
    shouldPersist = needsStateMigration(raw);
  } catch {
    shouldPersist = true;
  }
  const data = normalizeStateData(raw);
  if (shouldPersist && options.persist !== false) {
    await saveState(data, options);
  }
  return { path: targetPath, data };
}

export async function saveState(data, options = {}) {
  const targetPath = statePathFor(options);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(toStoredStateData(data), null, 2)}\n`);
  return targetPath;
}

export function normalizeStateData(raw = {}) {
  const now = new Date().toISOString();
  const source = raw && typeof raw === "object" ? raw : {};
  const groups = Array.isArray(source.groups)
    ? source.groups.map((group, index) => normalizeGroup(group, index)).filter(Boolean)
    : [normalizeGroup(source, 0, "默认分组")];

  if (groups.length === 0) {
    groups.push(normalizeGroup({}, 0, "默认分组"));
  }

  const activeGroupId = groups.some((group) => group.id === source.activeGroupId)
    ? source.activeGroupId
    : groups[0].id;
  const normalized = {
    groups,
    activeGroupId,
    updatedAt: source.updatedAt ?? now,
  };

  const activeGroup = getActiveGroup(normalized);
  if (activeGroup && Object.hasOwn(source, "ccTitle")) {
    activeGroup.ccTitle = String(source.ccTitle ?? "");
  }
  if (activeGroup && Object.hasOwn(source, "codexThreadId")) {
    activeGroup.codexThreadId = String(source.codexThreadId ?? "");
  }

  return withActiveAliases(normalized);
}

export function getActiveGroup(stateOrData) {
  const data = unwrapStateData(stateOrData);
  const groups = Array.isArray(data.groups) ? data.groups : [];
  return groups.find((group) => group.id === data.activeGroupId) ?? groups[0] ?? null;
}

export function setActiveGroup(stateOrData, groupId) {
  const data = normalizeStateData(unwrapStateData(stateOrData));
  if (!data.groups.some((group) => group.id === groupId)) {
    throw new Error("Group not found");
  }
  return withActiveAliases({
    ...data,
    activeGroupId: groupId,
    updatedAt: new Date().toISOString(),
  });
}

export function createGroup(stateOrData, name) {
  const data = normalizeStateData(unwrapStateData(stateOrData));
  const group = normalizeGroup({ name }, data.groups.length, defaultGroupName(data.groups.length + 1));
  const next = {
    groups: [...data.groups, group],
    activeGroupId: group.id,
    updatedAt: new Date().toISOString(),
  };
  return { data: withActiveAliases(next), group };
}

export function deleteGroup(stateOrData, groupId) {
  const data = normalizeStateData(unwrapStateData(stateOrData));
  if (data.groups.length <= 1) throw new Error("Cannot delete the last group");
  if (!data.groups.some((group) => group.id === groupId)) throw new Error("Group not found");
  const groups = data.groups.filter((group) => group.id !== groupId);
  const activeGroupId = data.activeGroupId === groupId ? groups[0].id : data.activeGroupId;
  return withActiveAliases({
    groups,
    activeGroupId,
    updatedAt: new Date().toISOString(),
  });
}

export function updateActiveGroup(stateOrData, updates = {}) {
  const data = normalizeStateData(unwrapStateData(stateOrData));
  const groups = data.groups.map((group) => {
    if (group.id !== data.activeGroupId) return group;
    return normalizeGroup({ ...group, ...updates }, 0, group.name);
  });
  return withActiveAliases({
    groups,
    activeGroupId: data.activeGroupId,
    updatedAt: new Date().toISOString(),
  });
}

function compareVersions(a, b) {
  const left = String(a).split(".").map((part) => Number(part) || 0);
  const right = String(b).split(".").map((part) => Number(part) || 0);
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function normalizeGroup(group, index, fallbackName = defaultGroupName(index + 1)) {
  if (!group || typeof group !== "object") return null;
  return {
    id: String(group.id ?? randomUUID()),
    name: String(group.name || fallbackName).trim() || fallbackName,
    ccTitle: String(group.ccTitle ?? ""),
    codexThreadId: String(group.codexThreadId ?? ""),
    createdAt: String(group.createdAt ?? new Date().toISOString()),
  };
}

function defaultGroupName(number) {
  return number <= 1 ? "默认分组" : `分组 ${number}`;
}

function unwrapStateData(stateOrData) {
  return stateOrData?.data && typeof stateOrData.data === "object" ? stateOrData.data : stateOrData ?? {};
}

function withActiveAliases(data) {
  const activeGroup = getActiveGroup(data);
  return {
    ...data,
    ccTitle: activeGroup?.ccTitle ?? "",
    codexThreadId: activeGroup?.codexThreadId ?? "",
  };
}

function toStoredStateData(data) {
  const normalized = normalizeStateData(data);
  return {
    groups: normalized.groups,
    activeGroupId: normalized.activeGroupId,
    updatedAt: normalized.updatedAt,
  };
}

function needsStateMigration(raw) {
  if (!raw || typeof raw !== "object") return true;
  if (!Array.isArray(raw.groups) || raw.groups.length === 0) return true;
  return Object.hasOwn(raw, "ccTitle") || Object.hasOwn(raw, "codexThreadId");
}
