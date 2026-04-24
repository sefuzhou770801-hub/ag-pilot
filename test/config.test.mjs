import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findLatestAutoAcceptExtension,
  readAutoAcceptSettings,
  statePathFor,
} from "../lib/config.mjs";

test("findLatestAutoAcceptExtension picks the highest installed AutoAccept version", async () => {
  const root = await makeTempDir();
  const oldPath = path.join(root, "yazanbaker.antigravity-autoaccept-3.1.0");
  const newPath = path.join(root, "yazanbaker.antigravity-autoaccept-3.26.5");
  await mkdir(oldPath, { recursive: true });
  await mkdir(newPath, { recursive: true });
  await writeFile(path.join(oldPath, "package.json"), JSON.stringify({ version: "3.1.0" }));
  await writeFile(path.join(newPath, "package.json"), JSON.stringify({ version: "3.26.5" }));

  const found = await findLatestAutoAcceptExtension(root);

  assert.equal(found.version, "3.26.5");
  assert.equal(found.path, newPath);
});

test("readAutoAcceptSettings returns the configured CDP port", async () => {
  const root = await makeTempDir();
  const settingsPath = path.join(root, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ "autoAcceptV2.cdpPort": 9444 }));

  const settings = await readAutoAcceptSettings(settingsPath);

  assert.equal(settings.cdpPort, 9444);
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
