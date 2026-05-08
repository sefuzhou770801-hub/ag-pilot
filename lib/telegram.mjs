const BASE = "https://api.telegram.org/bot";

export class TelegramClient {
  constructor(token, options = {}) {
    if (!token) throw new Error("Telegram bot token is required");
    this.token = token;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async sendMessage(chatId, text, options = {}) {
    return await this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode ?? "Markdown",
    });
  }

  async sendPhoto(chatId, photoBuffer, caption = "") {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", new Blob([photoBuffer], { type: "image/png" }), "screenshot.png");
    if (caption) form.append("caption", caption);

    const url = `${BASE}${this.token}/sendPhoto`;
    const response = await this.fetchImpl(url, { method: "POST", body: form });
    const data = await response.json();
    if (!data.ok) throw new Error(`Telegram API sendPhoto: ${data.description ?? "unknown error"}`);
    return data.result;
  }

  async getUpdates(offset = 0, timeout = 30) {
    return await this.call("getUpdates", {
      offset,
      timeout,
      allowed_updates: ["message"],
    });
  }

  async call(method, body) {
    const url = `${BASE}${this.token}/${method}`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!data.ok) throw new Error(`Telegram API ${method}: ${data.description ?? "unknown error"}`);
    return data.result;
  }
}

export function startPolling(client, handler, options = {}) {
  const signal = options.signal;
  let offset = 0;
  let running = true;

  if (signal) signal.addEventListener("abort", () => { running = false; });

  const loop = async () => {
    while (running) {
      try {
        const updates = await client.getUpdates(offset, 30);
        for (const update of updates) {
          offset = update.update_id + 1;
          try {
            await handler(update);
          } catch (err) {
            console.error("Handler error:", err.message);
          }
        }
      } catch (err) {
        if (!running) break;
        console.error("Polling error:", err.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };

  const promise = loop();
  return { stop: () => { running = false; }, done: promise };
}
