import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  normalizeStateData,
  readBridgeConfig,
  statePathFor,
  updateGroup,
  updateGroupsByCodexThreadId,
} from "../lib/config.mjs";

test("readBridgeConfig uses AG_CDP_PORT before state and Antigravity settings", async () => {
  const root = await makeTempDir();
  const statePath = path.join(root, "state.json");
  const settingsPath = path.join(root, "settings.json");
  await writeFile(statePath, JSON.stringify({ cdpPort: 9555 }));
  await writeFile(settingsPath, JSON.stringify({ "autoAcceptV2.cdpPort": 9444 }));

  const config = await readBridgeConfig({ statePath, settingsPath, env: { AG_CDP_PORT: "9666" } });

  assert.equal(config.cdpPort, 9666);
  assert.equal(config.source, "env");
});

test("readBridgeConfig uses state before Antigravity settings", async () => {
  const root = await makeTempDir();
  const statePath = path.join(root, "state.json");
  const settingsPath = path.join(root, "settings.json");
  await writeFile(statePath, JSON.stringify({ cdpPort: 9555 }));
  await writeFile(settingsPath, JSON.stringify({ "autoAcceptV2.cdpPort": 9444 }));

  const config = await readBridgeConfig({ statePath, settingsPath, env: {} });

  assert.equal(config.cdpPort, 9555);
  assert.equal(config.source, "state");
});

test("readBridgeConfig keeps old Antigravity CDP setting as fallback", async () => {
  const root = await makeTempDir();
  const statePath = path.join(root, "state.json");
  const settingsPath = path.join(root, "settings.json");
  await writeFile(statePath, JSON.stringify({}));
  await writeFile(settingsPath, JSON.stringify({ "autoAcceptV2.cdpPort": 9444 }));

  const config = await readBridgeConfig({ statePath, settingsPath, env: {} });

  assert.equal(config.cdpPort, 9444);
  assert.equal(config.source, "antigravity-settings");
});

test("statePathFor uses explicit paths before the project-local default", () => {
  assert.equal(statePathFor({ statePath: "/tmp/bridge-state.json" }), "/tmp/bridge-state.json");
  assert.equal(statePathFor({ projectRoot: "/tmp/ag-pilot-root" }), "/tmp/ag-pilot-root/state.json");
  assert.match(statePathFor(), /ag-pilot\/state\.json$/);
});

test("normalizeStateData adds codex busy state to groups", () => {
  const data = normalizeStateData({
    groups: [
      {
        id: "default",
        name: "默认分组",
        ccTitle: "CC",
        codexThreadId: "019thread",
      },
    ],
    activeGroupId: "default",
    viewGroupId: "default",
  });

  assert.equal(data.groups[0].codexBusy, false);
});

test("updateGroup can mark one group's Codex state as busy", () => {
  const data = updateGroup({
    groups: [
      { id: "default", name: "默认分组", codexBusy: false },
      { id: "open-source", name: "开源方案", codexBusy: false },
    ],
    activeGroupId: "default",
    viewGroupId: "open-source",
  }, "open-source", { codexBusy: true });

  assert.equal(data.groups.find((group) => group.id === "default").codexBusy, false);
  assert.equal(data.groups.find((group) => group.id === "open-source").codexBusy, true);
});

test("updateGroupsByCodexThreadId clears every group bound to the same thread", () => {
  const result = updateGroupsByCodexThreadId({
    groups: [
      { id: "open-source", name: "开源方案", codexThreadId: "019same", codexBusy: true },
      { id: "streamdeck", name: "streamdeck", codexThreadId: "019same", codexBusy: true },
      { id: "wiki", name: "个人维基", codexThreadId: "019wiki", codexBusy: true },
    ],
    activeGroupId: "open-source",
    viewGroupId: "open-source",
  }, "019same", { codexBusy: false });

  assert.deepEqual(result.groups.map((group) => group.name), ["开源方案", "streamdeck"]);
  assert.equal(result.data.groups.find((group) => group.id === "open-source").codexBusy, false);
  assert.equal(result.data.groups.find((group) => group.id === "streamdeck").codexBusy, false);
  assert.equal(result.data.groups.find((group) => group.id === "wiki").codexBusy, true);
});

async function makeTempDir() {
  return await mkdir(path.join(os.tmpdir(), `ag-pilot-${Date.now()}-${Math.random()}`), {
    recursive: true,
  });
}
