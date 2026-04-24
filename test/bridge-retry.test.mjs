import assert from "node:assert/strict";
import test from "node:test";

import { sendTextToAntigravityWithRetry } from "../bridge.mjs";

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
