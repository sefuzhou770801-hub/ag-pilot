import assert from "node:assert/strict";
import test from "node:test";

import { TelegramClient } from "../lib/telegram.mjs";

test("sendMessage calls Telegram API with correct payload", async () => {
  const requests = [];
  const client = new TelegramClient("test-token", {
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true, result: {} }) };
    },
  });

  await client.sendMessage(123, "hello");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.telegram.org/bottest-token/sendMessage");
  assert.deepEqual(requests[0].body, { chat_id: 123, text: "hello", parse_mode: "Markdown" });
});

test("getUpdates passes offset and timeout", async () => {
  const requests = [];
  const client = new TelegramClient("test-token", {
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true, result: [] }) };
    },
  });

  await client.getUpdates(42, 30);
  assert.equal(requests[0].body.offset, 42);
  assert.equal(requests[0].body.timeout, 30);
});

test("sendMessage throws on API error", async () => {
  const client = new TelegramClient("bad-token", {
    fetch: async () => ({
      ok: true,
      json: async () => ({ ok: false, description: "Unauthorized" }),
    }),
  });

  await assert.rejects(() => client.sendMessage(1, "x"), /Unauthorized/);
});

test("constructor throws without token", () => {
  assert.throws(() => new TelegramClient(""), /token is required/);
});
