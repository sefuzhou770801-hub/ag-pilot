import assert from "node:assert/strict";
import test from "node:test";

import { resolveRoutingGroup, sendTextToAntigravityWithRetry } from "../bridge.mjs";

const groupedState = {
  data: {
    groups: [
      {
        id: "default",
        name: "默认分组",
        ccTitle: "Synchronizing Codex App Messages",
        codexThreadId: "019default",
      },
      {
        id: "open-source",
        name: "开源方案",
        ccTitle: "Decoupling Antigravity-Codex Bridge",
        codexThreadId: "019opensource",
      },
    ],
    activeGroupId: "default",
    viewGroupId: "open-source",
  },
};

test("routing defaults to the selected bridge group instead of the old active aliases", () => {
  const group = resolveRoutingGroup(groupedState, {});

  assert.equal(group.name, "开源方案");
  assert.equal(group.ccTitle, "Decoupling Antigravity-Codex Bridge");
  assert.equal(group.codexThreadId, "019opensource");
});

test("routing can target a fixed group by name", () => {
  const group = resolveRoutingGroup(groupedState, { group: "默认分组" });

  assert.equal(group.name, "默认分组");
  assert.equal(group.ccTitle, "Synchronizing Codex App Messages");
  assert.equal(group.codexThreadId, "019default");
});

test("ag-send retries once after the first failure", async () => {
  let attempts = 0;
  const result = await sendTextToAntigravityWithRetry(
    { title: "Manager", text: "hello" },
    {
      waitMs: 0,
      sender: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary failure");
        return { sent: true, targetTitle: "Manager" };
      },
    },
  );

  assert.equal(attempts, 2);
  assert.equal(result.sent, true);
  assert.equal(result.retried, true);
});

test("ag-send reports retried when both attempts fail", async () => {
  let attempts = 0;

  await assert.rejects(
    () => sendTextToAntigravityWithRetry(
      { title: "Manager", text: "hello" },
      {
        waitMs: 0,
        sender: async () => {
          attempts += 1;
          throw new Error(`failure ${attempts}`);
        },
      },
    ),
    (error) => {
      assert.equal(error.retried, true);
      assert.match(error.message, /first attempt also failed/);
      return true;
    },
  );

  assert.equal(attempts, 2);
});
