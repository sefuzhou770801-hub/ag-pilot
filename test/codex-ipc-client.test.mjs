import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  defaultCodexSocketPath,
  openCodexThread,
  probeCodexThread,
  sendToCodexThread,
} from "../lib/codex-ipc-client.mjs";

test("defaultCodexSocketPath points to the current user's local IPC socket", () => {
  assert.equal(defaultCodexSocketPath(), path.join(os.tmpdir(), "codex-ipc", `ipc-${process.getuid()}.sock`));
});

test("openCodexThread opens the codex thread URL through a mocked open command", async (t) => {
  const root = await makeTempDir("open");
  const logPath = await installFakeOpen(t, root);

  await openCodexThread("019thread");

  const lines = (await readFile(logPath, "utf8")).trim().split(/\n/).map((line) => JSON.parse(line));
  assert.deepEqual(lines, [["codex://threads/019thread"]]);
});

test("sendToCodexThread refuses to inject into the currently executing Codex thread", async (t) => {
  setEnv(t, { CODEX_THREAD_ID: "019current" });

  const result = await sendToCodexThread("019current", "hello");

  assert.equal(result.ok, false);
  assert.equal(result.error, "refusingCurrentThreadSend");
});

test("probeCodexThread observes the owner client from a mocked IPC server", async (t) => {
  const root = await makeTempDir("probe");
  await installFakeOpen(t, root);
  const socketPath = await startFakeCodexIpc(t);

  const result = await probeCodexThread("019probe", { socketPath, waitMs: 500 });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "probe");
  assert.equal(result.clientId, "client-test");
  assert.equal(result.ownerClientId, "owner-test");
});

test("sendToCodexThread sends the requested text to the owner client over mocked IPC", async (t) => {
  const root = await makeTempDir("send");
  await installFakeOpen(t, root);
  const sentTurns = [];
  const socketPath = await startFakeCodexIpc(t, {
    onTurn(frame) {
      sentTurns.push(frame);
    },
  });

  const result = await sendToCodexThread("019target", "ship it", {
    socketPath,
    waitMs: 500,
    cwd: "/tmp/ag-pilot-test",
  });

  assert.equal(result.ok, true);
  assert.equal(result.sent, true);
  assert.equal(result.ownerClientId, "owner-test");
  assert.equal(sentTurns.length, 1);
  assert.equal(sentTurns[0].targetClientId, "owner-test");
  assert.equal(sentTurns[0].params.conversationId, "019target");
  assert.equal(sentTurns[0].params.turnStartParams.input[0].text, "ship it");
  assert.equal(sentTurns[0].params.turnStartParams.cwd, "/tmp/ag-pilot-test");
});

async function installFakeOpen(t, root) {
  const binDir = await mkdir(path.join(root, "bin"), { recursive: true });
  const logPath = path.join(root, "open-log.jsonl");
  const openPath = path.join(binDir, "open");
  await writeFile(
    openPath,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.AG_PILOT_FAKE_OPEN_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
`,
  );
  await chmod(openPath, 0o755);
  await writeFile(logPath, "");
  setEnv(t, { PATH: `${binDir}:${process.env.PATH ?? ""}`, AG_PILOT_FAKE_OPEN_LOG: logPath });
  return logPath;
}

async function startFakeCodexIpc(t, hooks = {}) {
  const root = await makeTempDir("socket");
  const socketPath = path.join(root, "codex.sock");
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const size = buffer.readUInt32LE(0);
        if (buffer.length < 4 + size) return;
        const frame = JSON.parse(buffer.slice(4, 4 + size).toString("utf8"));
        buffer = buffer.slice(4 + size);
        if (frame.method === "initialize") {
          writeFrame(socket, {
            type: "response",
            requestId: frame.requestId,
            resultType: "success",
            result: { clientId: "client-test" },
          });
          writeFrame(socket, {
            type: "broadcast",
            method: "thread-stream-state-changed",
            sourceClientId: "owner-test",
            params: { conversationId: "019target" },
          });
          writeFrame(socket, {
            type: "broadcast",
            method: "thread-stream-state-changed",
            sourceClientId: "owner-test",
            params: { conversationId: "019probe" },
          });
        }
        if (frame.method === "thread-follower-start-turn") {
          hooks.onTurn?.(frame);
          writeFrame(socket, {
            type: "response",
            requestId: frame.requestId,
            resultType: "success",
            result: {},
          });
        }
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  t.after(() => server.close());
  return socketPath;
}

function writeFrame(socket, frame) {
  const body = Buffer.from(JSON.stringify(frame), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
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

async function makeTempDir(label) {
  return await mkdir(path.join("/tmp", `agp-ipc-${label}-${process.pid}-${Date.now()}`), {
    recursive: true,
  });
}
