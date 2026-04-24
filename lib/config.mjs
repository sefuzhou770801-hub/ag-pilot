import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_ANTIGRAVITY_SETTINGS_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Antigravity",
  "User",
  "settings.json",
);

export const DEFAULT_CODEX_SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions");
export const DEFAULT_AG_CDP_PORT = 9333;

export function statePathFor(options = {}) {
  if (options.statePath) return options.statePath;
  if (options.projectRoot) return path.join(options.projectRoot, "state.json");
  return path.join(PROJECT_ROOT, "state.json");
}

export async function readBridgeConfig(options = {}) {
  const env = options.env ?? process.env;
  const settingsPath = options.settingsPath ?? DEFAULT_ANTIGRAVITY_SETTINGS_PATH;
  const statePath = statePathFor(options);
  const envPort = parsePort(env.AG_CDP_PORT);
  const stateData = await readJsonFile(statePath);
  const settingsData = await readJsonFile(settingsPath);
  const statePort = Object.hasOwn(stateData, "cdpPort") ? parsePort(stateData.cdpPort) : null;
  // Legacy fallback for users who previously configured the port through AutoAccept.
  const settingsPort = parsePort(settingsData["autoAcceptV2.cdpPort"]);
  const cdpPort = envPort ?? statePort ?? settingsPort ?? DEFAULT_AG_CDP_PORT;
  return {
    path: settingsPath,
    statePath,
    cdpPort,
    source: envPort != null ? "env" : statePort != null ? "state" : settingsPort != null ? "antigravity-settings" : "default",
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
  const viewGroupId = groups.some((group) => group.id === source.viewGroupId)
    ? source.viewGroupId
    : activeGroupId;
  const normalized = {
    groups,
    activeGroupId,
    viewGroupId,
    cdpPort: parsePort(source.cdpPort),
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

export function getViewGroup(stateOrData) {
  const data = unwrapStateData(stateOrData);
  const groups = Array.isArray(data.groups) ? data.groups : [];
  return groups.find((group) => group.id === data.viewGroupId) ?? getActiveGroup(data);
}

export function findGroup(stateOrData, groupRef) {
  const data = normalizeStateData(unwrapStateData(stateOrData));
  const needle = String(groupRef ?? "").trim();
  if (!needle) return null;
  return data.groups.find((group) => group.id === needle || group.name === needle) ?? null;
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

export function setViewGroup(stateOrData, groupId) {
  const data = normalizeStateData(unwrapStateData(stateOrData));
  if (!data.groups.some((group) => group.id === groupId)) {
    throw new Error("Group not found");
  }
  return withActiveAliases({
    ...data,
    viewGroupId: groupId,
    updatedAt: new Date().toISOString(),
  });
}

export function createGroup(stateOrData, name) {
  const data = normalizeStateData(unwrapStateData(stateOrData));
  const group = normalizeGroup({ name }, data.groups.length, defaultGroupName(data.groups.length + 1));
  const next = {
    groups: [...data.groups, group],
    activeGroupId: data.activeGroupId,
    viewGroupId: group.id,
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
  const viewGroupId = data.viewGroupId === groupId ? activeGroupId : data.viewGroupId;
  return withActiveAliases({
    groups,
    activeGroupId,
    viewGroupId,
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
    viewGroupId: data.viewGroupId,
    updatedAt: new Date().toISOString(),
  });
}

export function updateViewGroup(stateOrData, updates = {}) {
  const data = normalizeStateData(unwrapStateData(stateOrData));
  const viewGroup = getViewGroup(data);
  const groups = data.groups.map((group) => {
    if (group.id !== viewGroup?.id) return group;
    return normalizeGroup({ ...group, ...updates }, 0, group.name);
  });
  return withActiveAliases({
    groups,
    activeGroupId: data.activeGroupId,
    viewGroupId: data.viewGroupId,
    updatedAt: new Date().toISOString(),
  });
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
  const stored = {
    groups: normalized.groups,
    activeGroupId: normalized.activeGroupId,
    viewGroupId: normalized.viewGroupId,
    updatedAt: normalized.updatedAt,
  };
  if (normalized.cdpPort) stored.cdpPort = normalized.cdpPort;
  return stored;
}

function needsStateMigration(raw) {
  if (!raw || typeof raw !== "object") return true;
  if (!Array.isArray(raw.groups) || raw.groups.length === 0) return true;
  if (!raw.viewGroupId) return true;
  return Object.hasOwn(raw, "ccTitle") || Object.hasOwn(raw, "codexThreadId");
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

function parsePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}
