import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readBridgeConfig,
  statePathFor,
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
  assert.equal(statePathFor({ projectRoot: "/Users/example/cc-codex-bridge" }), "/Users/example/cc-codex-bridge/state.json");
  assert.match(statePathFor(), /cc-codex-bridge\/state\.json$/);
});

async function makeTempDir() {
  return await mkdir(path.join(os.tmpdir(), `cc-codex-bridge-${Date.now()}-${Math.random()}`), {
    recursive: true,
  });
}
