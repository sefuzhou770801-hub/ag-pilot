export class CdpClient {
  constructor(wsUrl, options = {}) {
    this.wsUrl = wsUrl;
    this.timeoutMs = Number(options.timeoutMs ?? 10000);
    const WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
    if (!WebSocketImpl) throw new Error("WebSocket is not available in this Node runtime");

    this.socket = new WebSocketImpl(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.openPromise = this.waitForOpen();
    this.socket.addEventListener("message", (event) => this.handleMessage(event.data));
    this.socket.addEventListener("error", () => this.rejectAll(new Error(`CDP socket error: ${wsUrl}`)));
    this.socket.addEventListener("close", () => this.rejectAll(new Error(`CDP socket closed: ${wsUrl}`)));
  }

  async send(method, params = {}) {
    await this.openPromise;
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ id, method, params });

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
    });

    this.socket.send(payload);
    return await promise;
  }

  async evaluate(expression, options = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: options.awaitPromise ?? true,
      returnByValue: options.returnByValue ?? true,
    });
    return unwrapRuntimeValue(result);
  }

  async insertText(text) {
    return await this.send("Input.insertText", { text });
  }

  async pressEnter() {
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
  }

  close() {
    this.socket.close();
  }

  waitForOpen() {
    if (this.socket.readyState === 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`CDP socket failed to open: ${this.wsUrl}`));
      };
      const cleanup = () => {
        this.socket.removeEventListener?.("open", onOpen);
        this.socket.removeEventListener?.("error", onError);
      };
      this.socket.addEventListener("open", onOpen);
      this.socket.addEventListener("error", onError);
    });
  }

  handleMessage(data) {
    let frame;
    try {
      frame = JSON.parse(typeof data === "string" ? data : data.toString());
    } catch {
      return;
    }
    if (!frame.id || !this.pending.has(frame.id)) return;
    const item = this.pending.get(frame.id);
    this.pending.delete(frame.id);
    clearTimeout(item.timer);
    if (frame.error) {
      item.reject(new Error(`${item.method} failed: ${JSON.stringify(frame.error)}`));
    } else {
      item.resolve(frame);
    }
  }

  rejectAll(error) {
    for (const [id, item] of this.pending) {
      clearTimeout(item.timer);
      item.reject(error);
      this.pending.delete(id);
    }
  }
}

export function unwrapRuntimeValue(result) {
  if (result?.result?.result && Object.hasOwn(result.result.result, "value")) {
    return result.result.result.value;
  }
  if (result?.result && Object.hasOwn(result.result, "value")) {
    return result.result.value;
  }
  if (result && Object.hasOwn(result, "value")) {
    return result.value;
  }
  return result;
}
