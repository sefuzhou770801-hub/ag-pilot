#!/usr/bin/env node

import os from "node:os";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const GEMINI_COMMAND = "gemini";
let currentThreadId = null;
let activeGemini = null;

function log(message) {
  process.stderr.write(`[gemini-bridge] ${message}\n`);
}

function writeJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function respond(id, result) {
  writeJson({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  writeJson({ jsonrpc: "2.0", id, error: { code, message } });
}

function notify(method, params = {}) {
  writeJson({ jsonrpc: "2.0", method, params });
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function firstText(items) {
  if (!Array.isArray(items)) return null;

  for (const item of items) {
    if (typeof item?.text === "string") return item.text;
  }

  return null;
}

function readPrompt(params = {}) {
  if (typeof params.prompt === "string") return params.prompt;
  if (typeof params.input === "string") return params.input;
  if (typeof params.userInput === "string") return params.userInput;

  return firstText(params.input) ?? firstText(params.userInput) ?? "";
}

function readCwd(params = {}) {
  return typeof params.cwd === "string" && params.cwd.length > 0
    ? params.cwd
    : process.cwd();
}

function platformOs() {
  return os.platform() === "darwin" ? "macos" : os.platform();
}

function combineOutput(stdout, stderr) {
  if (stdout && stderr) return `${stdout}\n[stderr]\n${stderr}`;
  return stdout || stderr || "";
}

function runGemini(prompt, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(GEMINI_COMMAND, ["--prompt", prompt], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    activeGemini = child;

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      activeGemini = null;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      activeGemini = null;

      if (exitCode === 0) {
        resolve({ stdout, stderr, exitCode, signal });
        return;
      }

      const error = new Error(
        signal
          ? `Gemini exited after signal ${signal}`
          : `Gemini exited with code ${exitCode}`,
      );
      error.stdout = stdout;
      error.stderr = stderr;
      error.exitCode = exitCode;
      error.signal = signal;
      reject(error);
    });
  });
}

async function handleTurnStart(id, params = {}) {
  const prompt = readPrompt(params);
  const cwd = readCwd(params);
  const turnId = randomUUID();

  if (!prompt) {
    respondError(id, -32602, "turn/start requires a text prompt");
    notify("turn/failed", {
      turn: { id: turnId, status: "failed" },
      error: { message: "turn/start requires a text prompt" },
    });
    process.exit(1);
  }

  currentThreadId = params.threadId || currentThreadId || randomUUID();
  respond(id, {
    turn: {
      id: turnId,
      threadId: currentThreadId,
      status: "running",
      createdAt: nowSeconds(),
      updatedAt: nowSeconds(),
    },
  });

  log(`starting Gemini in ${cwd}`);

  try {
    const result = await runGemini(prompt, cwd);
    const outputText = combineOutput(result.stdout, result.stderr);

    if (outputText) {
      notify("item/agentMessage/delta", { delta: outputText });
    }

    notify("turn/completed", {
      turn: { id: turnId, status: "completed" },
      output: {
        text: outputText,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      },
    });
    process.exit(0);
  } catch (error) {
    const outputText = combineOutput(error.stdout || "", error.stderr || "");

    if (outputText) {
      notify("item/agentMessage/delta", { delta: outputText });
    }

    log(error.message);
    notify("turn/failed", {
      turn: { id: turnId, status: "failed" },
      error: {
        message: error.message,
        stdout: error.stdout || "",
        stderr: error.stderr || "",
        exitCode: error.exitCode ?? null,
        signal: error.signal ?? null,
      },
    });
    process.exit(1);
  }
}

async function handleMessage(message) {
  const { id, method, params } = message;

  switch (method) {
    case "initialize":
      respond(id, {
        userAgent: `symphony-gemini-bridge/0.1.0 (${os.platform()} ${os.release()}; ${os.arch()})`,
        platformFamily: "unix",
        platformOs: platformOs(),
      });
      break;

    case "initialized":
      break;

    case "thread/start": {
      currentThreadId = randomUUID();
      const timestamp = nowSeconds();
      respond(id, {
        thread: {
          id: currentThreadId,
          status: "idle",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });
      break;
    }

    case "turn/start":
      await handleTurnStart(id, params || {});
      break;

    case "turn/interrupt":
      if (activeGemini) {
        activeGemini.kill("SIGINT");
      }
      respond(id, {});
      process.exit(0);
      break;

    default:
      respondError(id, -32601, `Method not found: ${method}`);
      break;
  }
}

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch (error) {
    log(`invalid JSON ignored: ${error.message}`);
    return;
  }

  try {
    await handleMessage(message);
  } catch (error) {
    log(`message handling failed: ${error.message}`);
    if (message?.id !== undefined) {
      respondError(message.id, -32603, error.message);
    }
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (activeGemini) {
      activeGemini.kill(signal);
    }
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}
