import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const INITIALIZING_CLIENT_ID = "initializing-client";

export function defaultCodexSocketPath() {
  return path.join(os.tmpdir(), "codex-ipc", `ipc-${process.getuid()}.sock`);
}

export async function openCodexThread(threadId) {
  if (!threadId) throw new Error("Codex thread id is required");
  await new Promise((resolve) => {
    execFile("open", [`codex://threads/${threadId}`], () => resolve());
  });
}

export async function probeCodexThread(threadId, options = {}) {
  return await runCodexIpc({ ...options, mode: "probe", threadId });
}

export async function sendToCodexThread(threadId, text, options = {}) {
  if (!text) throw new Error("Message text is required");
  return await runCodexIpc({ ...options, mode: "send", threadId, text });
}

async function runCodexIpc(options) {
  const threadId = options.threadId;
  if (!threadId) throw new Error("Codex thread id is required");
  if (
    options.mode === "send" &&
    process.env.CODEX_THREAD_ID &&
    process.env.CODEX_THREAD_ID === threadId &&
    process.env.CODEX_BRIDGE_ALLOW_CURRENT_THREAD !== "1" &&
    !options.allowCurrentThreadSend
  ) {
    return {
      ok: false,
      mode: options.mode,
      threadId,
      error: "refusingCurrentThreadSend",
      message: "Refusing to inject into the Codex thread currently executing this command.",
    };
  }

  const socketPath = options.socketPath ?? process.env.CODEX_IPC_SOCKET ?? defaultCodexSocketPath();
  const waitMs = Number(options.waitMs ?? process.env.CODEX_BRIDGE_WAIT_MS ?? 12000);
  const cwd = options.cwd ?? process.env.CODEX_BRIDGE_CWD ?? process.cwd();

  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = Buffer.alloc(0);
    let clientId = null;
    let ownerClientId = null;
    let initialized = false;
    let sent = false;
    let finished = false;
    const pending = new Map();
    const seen = [];

    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      for (const [, item] of pending) clearTimeout(item.timer);
      pending.clear();
      socket.end();
      resolve(result);
    };

    const fail = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      for (const [, item] of pending) clearTimeout(item.timer);
      pending.clear();
      socket.destroy();
      reject(error);
    };

    const deadline = setTimeout(() => {
      finish({
        ok: options.mode === "probe",
        mode: options.mode,
        threadId,
        initialized,
        clientId,
        ownerClientId,
        sent,
        error: ownerClientId ? null : "ownerClientId not observed for target thread",
        recentFrames: seen.slice(-20),
      });
    }, waitMs);

    const writeFrame = (frame) => {
      const body = Buffer.from(JSON.stringify(frame), "utf8");
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length, 0);
      socket.write(Buffer.concat([header, body]));
    };

    const request = (method, params, requestOptions = {}) => {
      const requestId = randomUUID();
      const frame = {
        type: "request",
        requestId,
        method,
        params,
        sourceClientId: clientId ?? INITIALIZING_CLIENT_ID,
        ...(requestOptions.targetClientId ? { targetClientId: requestOptions.targetClientId } : {}),
        ...(requestOptions.version ? { version: requestOptions.version } : {}),
      };

      const promise = new Promise((resolveRequest, rejectRequest) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          rejectRequest(new Error(`request timed out: ${method}`));
        }, Number(requestOptions.timeoutMs ?? 12000));
        pending.set(requestId, { method, resolve: resolveRequest, reject: rejectRequest, timer });
      });

      writeFrame(frame);
      return promise;
    };

    const noteFrame = (frame) => {
      const method = frame.method ?? frame.type;
      const conversationId = frame.params?.conversationId ?? null;
      const sourceClientId = typeof frame.sourceClientId === "string" ? frame.sourceClientId : null;

      if (frame.type === "broadcast" || frame.type === "request") {
        seen.push({
          type: frame.type,
          method,
          conversationId,
          sourceClientId,
          changeType: frame.params?.change?.type ?? null,
        });
      }

      if (
        frame.type === "broadcast" &&
        frame.method === "thread-stream-state-changed" &&
        conversationId === threadId &&
        sourceClientId
      ) {
        ownerClientId = sourceClientId;
      }
    };

    const maybeSend = async () => {
      if (options.mode !== "send" || sent || !ownerClientId || !initialized) return;
      sent = true;
      await request(
        "thread-follower-start-turn",
        {
          conversationId: threadId,
          turnStartParams: {
            threadId,
            input: [{ type: "text", text: options.text }],
            cwd,
            attachments: [],
          },
          isSteering: false,
        },
        { targetClientId: ownerClientId, version: 1, timeoutMs: 20000 },
      );
      finish({ ok: true, mode: "send", threadId, ownerClientId, sent: true });
    };

    const respondClientDiscovery = (requestId) => {
      writeFrame({
        type: "client-discovery-response",
        requestId,
        response: { canHandle: false },
      });
    };

    const respondNoHandler = (requestId) => {
      writeFrame({
        type: "response",
        requestId,
        resultType: "error",
        error: "no-handler-for-request",
      });
    };

    const handleFrame = async (frame) => {
      if (frame.type === "client-discovery-request") {
        respondClientDiscovery(frame.requestId);
        return;
      }

      if (frame.type === "request") {
        noteFrame(frame);
        respondNoHandler(frame.requestId);
        return;
      }

      noteFrame(frame);

      if (frame.type !== "response") {
        if (options.mode === "probe" && ownerClientId && initialized) {
          finish({ ok: true, mode: "probe", threadId, initialized, clientId, ownerClientId });
          return;
        }
        await maybeSend();
        return;
      }

      const item = pending.get(frame.requestId);
      if (!item) return;
      pending.delete(frame.requestId);
      clearTimeout(item.timer);

      if (frame.resultType === "error") {
        item.reject(new Error(`${item.method} failed: ${JSON.stringify(frame.error)}`));
        return;
      }

      if (item.method === "initialize" && frame.result?.clientId) {
        clientId = frame.result.clientId;
        initialized = true;
      }

      item.resolve(frame.result);
      if (options.mode === "probe" && ownerClientId && initialized) {
        finish({ ok: true, mode: "probe", threadId, initialized, clientId, ownerClientId });
        return;
      }
      await maybeSend();
    };

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const size = buffer.readUInt32LE(0);
        if (buffer.length < 4 + size) return;
        const raw = buffer.slice(4, 4 + size).toString("utf8");
        buffer = buffer.slice(4 + size);
        handleFrame(JSON.parse(raw)).catch(fail);
      }
    });

    socket.on("error", fail);

    socket.on("connect", async () => {
      try {
        await request("initialize", { clientType: "farfield" }, { version: 1, timeoutMs: 12000 });
        await openCodexThread(threadId);
      } catch (error) {
        fail(error);
      }
    });
  });
}
