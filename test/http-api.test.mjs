import assert from "node:assert/strict";
import test from "node:test";

import { createBridgeServer } from "../lib/http-api.mjs";

test("GET /api/snapshot builds the card snapshot from mocked dependencies", async () => {
  const state = makeState();
  await withServer(
    {
      loadState: async () => state,
      saveState: async () => {
        throw new Error("snapshot should not persist clean state");
      },
      getAntigravityStatus: async () => ({ cdp: { connected: false }, config: { cdpPort: 9333, source: "test" } }),
      defaultCodexSocketPath: () => "/tmp/ag-pilot-test.sock",
      existsSync: () => false,
      listAntigravityConversations: async () => [{ title: "Bound CC", running: false }],
      listRecentCodexThreads: async () => [{ threadId: "019recent", title: "Recent" }],
      listCodexThreadsFromDb: async () => ({ ok: true, threads: [{ threadId: "019db", title: "DB Thread" }] }),
      getCodexThreadTitle: async () => "Bound Codex",
      buildCardViewModel: ({ boundThreadTitle, status }) => ({
        boundThreadTitle,
        socketExists: status.codex.socketExists,
      }),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/snapshot`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.boundThreadTitle, "Bound Codex");
      assert.deepEqual(body.view, { boundThreadTitle: "Bound Codex", socketExists: false });
    },
  );
});

test("POST /api/groups/create saves a new group without touching external services", async () => {
  let saved = null;
  await withServer(
    {
      loadState: async () => makeState(),
      saveState: async (data) => {
        saved = data;
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/groups/create`, {
        method: "POST",
        body: JSON.stringify({ name: "  Open Source  " }),
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.group.name, "Open Source");
      assert.equal(saved.groups.length, 2);
      assert.equal(saved.viewGroupId, body.group.id);
    },
  );
});

test("POST /api/open-codex opens the bound thread through a mocked Codex client", async () => {
  const opened = [];
  await withServer(
    {
      loadState: async () => makeState(),
      openCodexThread: async (threadId) => {
        opened.push(threadId);
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/open-codex`, { method: "POST" });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(body, { ok: true });
      assert.deepEqual(opened, ["019bound"]);
    },
  );
});

test("POST /api/bind/codex rejects missing thread id before saving state", async () => {
  let saved = false;
  await withServer(
    {
      loadState: async () => makeState(),
      saveState: async () => {
        saved = true;
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/bind/codex`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.equal(saved, false);
    },
  );
});

async function withServer(dependencies, fn) {
  const server = createBridgeServer({ dependencies });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function makeState() {
  return {
    path: "/tmp/ag-pilot-state.json",
    data: {
      groups: [
        {
          id: "default",
          name: "Default",
          agTitle: "Bound CC",
          codexThreadId: "019bound",
          codexBusy: false,
        },
      ],
      activeGroupId: "default",
      viewGroupId: "default",
      cdpPort: 9333,
      updatedAt: "2026-04-30T00:00:00.000Z",
    },
  };
}
