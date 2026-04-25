import assert from "node:assert/strict";
import test from "node:test";

import { conversationClickPointScript, findBusyReadTarget, findTargetByTitle } from "../lib/antigravity-client.mjs";

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

test("conversationClickPointScript returns coordinates instead of DOM clicking", () => {
  const script = conversationClickPointScript("Decoupling Antigravity-Codex Bridge");

  assert.match(script, /getBoundingClientRect/);
  assert.match(script, /requestAnimationFrame/);
  assert.doesNotMatch(script, /\.click\(/);
});

test("busy read target uses the current chat without selecting a bound title", () => {
  const targets = [
    {
      type: "page",
      title: "Manager",
      url: "vscode-file://vscode-app/workbench.html",
      webSocketDebuggerUrl: "ws://manager",
    },
    {
      type: "page",
      title: "Current User Chat",
      url: "vscode-webview://current-chat/index.html",
      webSocketDebuggerUrl: "ws://current",
    },
    {
      type: "page",
      title: "Bound Group Chat",
      url: "vscode-file://vscode-app/workbench.html",
      webSocketDebuggerUrl: "ws://bound",
    },
  ];

  assert.equal(findBusyReadTarget(targets)?.webSocketDebuggerUrl, "ws://current");
});
