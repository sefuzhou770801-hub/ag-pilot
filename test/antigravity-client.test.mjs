import assert from "node:assert/strict";
import test from "node:test";

import { findTargetByTitle } from "../lib/antigravity-client.mjs";

test("findTargetByTitle does not match empty or unrelated target titles", () => {
  const targets = [
    {
      type: "page",
      title: "",
      url: "vscode-file://vscode-app/workbench.html",
      webSocketDebuggerUrl: "ws://empty",
    },
    {
      type: "iframe",
      title: "vscode-webview://example/index.html",
      url: "vscode-webview://example/index.html",
      webSocketDebuggerUrl: "ws://webview",
    },
  ];

  assert.equal(findTargetByTitle(targets, "Synchronizing Codex App Messages"), null);
});

test("findTargetByTitle still matches real Antigravity page titles", () => {
  const targets = [
    {
      type: "page",
      title: "Synchronizing Codex App Messages",
      url: "vscode-file://vscode-app/workbench.html",
      webSocketDebuggerUrl: "ws://conversation",
    },
  ];

  assert.equal(findTargetByTitle(targets, "Synchronizing Codex App Messages")?.webSocketDebuggerUrl, "ws://conversation");
});
