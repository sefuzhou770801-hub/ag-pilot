import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findLatestCodexRollout,
  listRecentCodexThreads,
  readLatestAssistantReply,
} from "../lib/codex-session-log.mjs";

test("readLatestAssistantReply returns the last assistant message text", async () => {
  const root = await makeTempDir();
  const rollout = path.join(root, "rollout-2026-04-24T17-39-03-thread-1.jsonl");
  await writeFile(
    rollout,
    [
      item("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }),
      item("response_item", { type: "function_call_output", output: "tool output should be ignored" }),
      item("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "first" }] }),
      item("response_item", {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: "second" },
          { type: "output_text", text: " reply" },
        ],
      }),
    ].join("\n"),
  );

  const reply = await readLatestAssistantReply(rollout);

  assert.equal(reply.text, "second reply");
  assert.equal(reply.line, 4);
});

test("findLatestCodexRollout finds the newest rollout file for a thread", async () => {
  const root = await makeTempDir();
  const day = path.join(root, "2026", "04", "24");
  await mkdir(day, { recursive: true });
  const oldFile = path.join(day, "rollout-2026-04-24T10-00-00-thread-2.jsonl");
  const newFile = path.join(day, "rollout-2026-04-24T11-00-00-thread-2.jsonl");
  await writeFile(oldFile, "old");
  await writeFile(newFile, "new");

  const found = await findLatestCodexRollout("thread-2", root);

  assert.equal(found, newFile);
});

test("listRecentCodexThreads returns newest unique thread ids", async () => {
  const root = await makeTempDir();
  const day = path.join(root, "2026", "04", "24");
  await mkdir(day, { recursive: true });
  await writeFile(path.join(day, "rollout-2026-04-24T10-00-00-thread-a.jsonl"), "a1");
  await writeFile(path.join(day, "rollout-2026-04-24T11-00-00-thread-b.jsonl"), "b");
  await writeFile(path.join(day, "rollout-2026-04-24T12-00-00-thread-a.jsonl"), "a2");

  const threads = await listRecentCodexThreads(root, 2);

  assert.deepEqual(threads.map((item) => item.threadId), ["thread-a", "thread-b"]);
});

function item(type, payload) {
  return JSON.stringify({ timestamp: new Date().toISOString(), type, payload });
}

async function makeTempDir() {
  return await mkdir(path.join(os.tmpdir(), `cc-codex-session-${Date.now()}-${Math.random()}`), {
    recursive: true,
  });
}
