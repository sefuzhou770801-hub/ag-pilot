import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const codexDbUrl = new URL("../lib/codex-db.mjs", import.meta.url).href;
let importCounter = 0;

test("listCodexThreadsFromDb returns a safe empty result when the Codex database is absent", async (t) => {
  const root = await makeTempDir();
  setEnv(t, { HOME: root });
  const { listCodexThreadsFromDb } = await freshCodexDbModule();

  const result = await listCodexThreadsFromDb();

  assert.deepEqual(result, { ok: false, error: "Codex 数据库不存在", threads: [] });
});

test("listCodexThreadsFromDb maps SQLite rows without using a real database", async (t) => {
  const root = await makeTempDir();
  await writeFile(path.join(await mkdir(path.join(root, ".codex"), { recursive: true }), "state_5.sqlite"), "");
  const binDir = await installFakeSqlite(root);
  setEnv(t, { HOME: root, PATH: `${binDir}:${process.env.PATH ?? ""}` });
  const { listCodexThreadsFromDb } = await freshCodexDbModule();

  const result = await listCodexThreadsFromDb(2);

  assert.equal(result.ok, true);
  assert.deepEqual(result.threads, [
    { threadId: "019thread-a", title: "Planning", updatedAt: "2026-04-30T00:00:00Z" },
    { threadId: "019thread-b", title: "对话 019threa", updatedAt: "2026-04-29T00:00:00Z" },
  ]);
});

test("getCodexThreadTitle returns the title from a mocked SQLite call", async (t) => {
  const root = await makeTempDir();
  await writeFile(path.join(await mkdir(path.join(root, ".codex"), { recursive: true }), "state_5.sqlite"), "");
  const binDir = await installFakeSqlite(root);
  setEnv(t, { HOME: root, PATH: `${binDir}:${process.env.PATH ?? ""}` });
  const { getCodexThreadTitle } = await freshCodexDbModule();

  assert.equal(await getCodexThreadTitle("019thread-a"), "Bound Thread");
  assert.equal(await getCodexThreadTitle(""), null);
});

async function freshCodexDbModule() {
  importCounter += 1;
  return await import(`${codexDbUrl}?case=${importCounter}`);
}

async function installFakeSqlite(root) {
  const binDir = await mkdir(path.join(root, "bin"), { recursive: true });
  const sqlitePath = path.join(binDir, "sqlite3");
  await writeFile(
    sqlitePath,
    `#!/bin/sh
last=""
for arg in "$@"; do last="$arg"; done
case "$last" in
  *"SELECT title"*) printf '%s' '[{"title":"Bound Thread"}]' ;;
  *) printf '%s' '[{"id":"019thread-a","title":"Planning","updated_at":"2026-04-30T00:00:00Z"},{"id":"019thread-b","title":"","updated_at":"2026-04-29T00:00:00Z"}]' ;;
esac
`,
  );
  await chmod(sqlitePath, 0o755);
  return binDir;
}

function setEnv(t, overrides) {
  const previous = new Map();
  for (const key of Object.keys(overrides)) {
    previous.set(key, Object.hasOwn(process.env, key) ? process.env[key] : undefined);
    process.env[key] = overrides[key];
  }
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function makeTempDir() {
  return await mkdir(path.join(os.tmpdir(), `ag-pilot-codex-db-${Date.now()}-${Math.random()}`), {
    recursive: true,
  });
}
