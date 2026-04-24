import assert from "node:assert/strict";
import test from "node:test";

import { buildCardViewModel, shortenThreadId } from "../lib/card-view-model.mjs";

test("shortenThreadId keeps the readable edges", () => {
  assert.equal(shortenThreadId("01900000-0000-7000-8000-000000000000"), "01900000...00000");
});

test("buildCardViewModel reports the selected CC conversation and mismatch risk", () => {
  const model = buildCardViewModel({
    state: {
      data: {
        codexThreadId: "01900000-0000-7000-8000-000000000000",
        ccTitle: "Bound CC",
      },
    },
    status: {
      autoAccept: { cdp: { connected: true }, plugin: { version: "3.26.5" } },
      codex: { socketExists: true },
    },
    conversations: [
      { title: "Other CC", status: "active", selected: true, running: false, recent: true },
      { title: "Bound CC", status: "recent", selected: false, running: false, recent: true },
    ],
  });

  assert.equal(model.codex.boundThreadShort, "01900000...00000");
  assert.equal(model.cc.selectedTitle, "Other CC");
  assert.equal(model.risk.level, "warning");
  assert.match(model.risk.message, /当前选中的 CC/);
});
