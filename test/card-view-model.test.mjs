import assert from "node:assert/strict";
import test from "node:test";

import { buildCardViewModel, shortenThreadId } from "../lib/card-view-model.mjs";

test("shortenThreadId keeps the readable edges", () => {
  assert.equal(shortenThreadId("01900000-0000-7000-8000-000000000000"), "01900000...00000");
});

test("buildCardViewModel keeps the bound CC even when another window is selected", () => {
  const model = buildCardViewModel({
    state: {
      data: {
        codexThreadId: "01900000-0000-7000-8000-000000000000",
        agTitle: "Bound CC",
      },
    },
    status: {
      antigravity: { cdp: { connected: true }, config: { cdpPort: 9333, source: "state" } },
      codex: { socketExists: true },
    },
    conversations: [
      { title: "Other CC", status: "active", selected: true, running: false, recent: true },
      { title: "Bound CC", status: "recent", selected: false, running: false, recent: true },
    ],
  });

  assert.equal(model.codex.boundThreadShort, "01900000...00000");
  assert.equal(model.ag.boundTitle, "Bound CC");
  assert.equal(model.ag.matched, true);
  assert.equal(model.risk.level, "ok");
  assert.equal(model.risk.message, "双向通道就绪");
});

test("buildCardViewModel keeps the viewed group title instead of active aliases", () => {
  const model = buildCardViewModel({
    state: {
      data: {
        groups: [
          {
            id: "default",
            name: "默认分组",
            agTitle: "Synchronizing Codex App Messages",
            codexThreadId: "019default",
          },
          {
            id: "open-source",
            name: "开源方案",
            agTitle: "Decoupling Antigravity-Codex Bridge",
            codexThreadId: "019opensource",
          },
        ],
        activeGroupId: "open-source",
        viewGroupId: "open-source",
        agTitle: "Synchronizing Codex App Messages",
        codexThreadId: "019default",
      },
    },
    status: {
      antigravity: { cdp: { connected: true }, config: { cdpPort: 9333, source: "state" } },
      codex: { socketExists: true },
    },
    conversations: [
      { title: "Decoupling Antigravity-Codex Bridge", status: "active", selected: true, running: false, recent: true },
    ],
  });

  assert.equal(model.ag.boundTitle, "Decoupling Antigravity-Codex Bridge");
  assert.equal(model.ag.matched, true);
  assert.equal(model.codex.boundThreadId, "019opensource");
  assert.equal(model.codex.boundThreadShort, "019opensource");
  assert.equal(model.codex.latestThreadId, "");
});

test("buildCardViewModel does not show active group codex aliases for an unbound viewed group", () => {
  const model = buildCardViewModel({
    state: {
      data: {
        groups: [
          {
            id: "default",
            name: "默认分组",
            agTitle: "Default CC",
            codexThreadId: "019default",
          },
          {
            id: "open-source",
            name: "开源方案",
            agTitle: "Decoupling Antigravity-Codex Bridge",
            codexThreadId: "",
          },
        ],
        activeGroupId: "open-source",
        viewGroupId: "open-source",
        agTitle: "Default CC",
        codexThreadId: "019default",
      },
    },
    status: {
      antigravity: { cdp: { connected: true }, config: { cdpPort: 9333, source: "state" } },
      codex: { socketExists: true },
    },
    codexDb: {
      threads: [
        { threadId: "019recent", title: "准备开源工作区", updatedAt: Date.now() },
      ],
    },
    conversations: [
      { title: "Decoupling Antigravity-Codex Bridge", status: "active", selected: true, running: false, recent: true },
    ],
  });

  assert.equal(model.codex.boundThreadId, "");
  assert.equal(model.codex.boundTitle, "");
  assert.equal(model.codex.latestTitle, "准备开源工作区");
  assert.equal(model.risk.level, "warning");
  assert.match(model.risk.message, /Codex 对话未绑定/);
});

test("buildCardViewModel reports both sides as busy", () => {
  const model = buildCardViewModel({
    state: {
      data: {
        groups: [
          {
            id: "open-source",
            name: "开源方案",
            agTitle: "Decoupling Antigravity-Codex Bridge",
            codexThreadId: "019opensource",
            codexBusy: true,
          },
        ],
        activeGroupId: "open-source",
        viewGroupId: "open-source",
      },
    },
    status: {
      antigravity: { cdp: { connected: true }, config: { cdpPort: 9333, source: "state" } },
      codex: { socketExists: true },
    },
    conversations: [
      { title: "Decoupling Antigravity-Codex Bridge", status: "active", selected: true, running: true, recent: true },
    ],
    antigravityBusy: { known: true, busy: true },
  });

  assert.equal(model.ag.busy, true);
  assert.equal(model.ag.statusLabel, "思考中");
  assert.equal(model.codex.busy, true);
  assert.equal(model.codex.statusLabel, "执行中");
  assert.equal(model.risk.message, "双向执行中");
});
