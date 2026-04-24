import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { CdpClient, unwrapRuntimeValue } from "../lib/cdp-client.mjs";

test("unwrapRuntimeValue returns nested Runtime.evaluate values", () => {
  assert.equal(unwrapRuntimeValue({ result: { result: { value: "ready" } } }), "ready");
  assert.equal(unwrapRuntimeValue({ result: { value: "ready" } }), "ready");
  assert.equal(unwrapRuntimeValue({ value: "ready" }), "ready");
});

test("CdpClient matches responses by id", async () => {
  const socket = new FakeSocket();
  const client = new CdpClient("ws://example", { WebSocketImpl: class extends FakeSocket {
    constructor() {
      super();
      return socket;
    }
  } });

  const pending = client.send("Runtime.evaluate", { expression: "1 + 1" });
  await new Promise((resolve) => setImmediate(resolve));
  const sent = JSON.parse(socket.sent[0]);
  socket.emit("message", JSON.stringify({ id: sent.id, result: { result: { value: 2 } } }));

  assert.equal(unwrapRuntimeValue(await pending), 2);
  client.close();
});

test("CdpClient clickAt sends real mouse events", async () => {
  const socket = new FakeSocket();
  const client = new CdpClient("ws://example", { WebSocketImpl: class extends FakeSocket {
    constructor() {
      super();
      return socket;
    }
  } });

  const click = client.clickAt(12, 34);
  for (let index = 0; index < 3; index += 1) {
    while (socket.sent.length <= index) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const sent = JSON.parse(socket.sent[index]);
    socket.emit("message", JSON.stringify({ id: sent.id, result: {} }));
  }
  await click;

  const events = socket.sent.map((payload) => JSON.parse(payload).params);
  assert.deepEqual(events.map((event) => event.type), ["mouseMoved", "mousePressed", "mouseReleased"]);
  assert.equal(events[1].button, "left");
  assert.equal(events[1].x, 12);
  assert.equal(events[1].y, 34);
  client.close();
});

class FakeSocket extends EventEmitter {
  sent = [];
  readyState = 1;

  addEventListener(name, handler) {
    this.on(name, (data) => handler({ data }));
  }

  removeEventListener(name, handler) {
    this.off(name, handler);
  }

  send(payload) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = 3;
  }
}
