# AG Pilot

> 同一台 Mac 上的两个 AI Agent，不用复制粘贴，直接本地路由。

[English](README.md) | **中文**

[![CI](https://github.com/sefuzhou770801-hub/ag-pilot/actions/workflows/test.yml/badge.svg)](https://github.com/sefuzhou770801-hub/ag-pilot/actions)
[![本地优先](https://img.shields.io/badge/本地优先-100%25-22d3ee?style=for-the-badge)](#为什么)
[![macOS](https://img.shields.io/badge/平台-macOS-a78bfa?style=for-the-badge)](#环境要求)
[![MIT](https://img.shields.io/badge/协议-MIT-34d399?style=for-the-badge)](LICENSE)

![AG Pilot 控制面板](docs/images/card-screenshot.png)

AG Pilot 把一个 Antigravity 对话绑定到一个 Codex 线程，通过 CDP 和本地 IPC 路由消息。零依赖、零云端，一切留在你的 Mac 上。

## 为什么

两个 Agent 协作时，最脆弱的不是模型——是人工复制粘贴的循环。

AG Pilot 干掉这个循环：

- **分组绑定** — 每个分组独立拥有一个 Antigravity 对话和一个 Codex 线程。
- **真实 CDP 选择** — Antigravity 通过真实鼠标事件切换，不是脆弱的 DOM 操作。
- **安全路由** — 消息发往绑定目标，不是当前窗口。
- **状态锁** — 发送时自动标记 Codex 忙碌，完成后释放。
- **Telegram 远程** — 用手机发消息、读回复、查状态。
- **纯本地** — 没有中继、没有数据库、没有密钥离开本机。

## 快速开始

```bash
git clone https://github.com/sefuzhou770801-hub/ag-pilot.git
cd ag-pilot
cp state.example.json state.json
./scripts/setup-cdp.sh          # 启用 Antigravity CDP
```

重启 Antigravity，然后绑定第一对：

```bash
node bridge.mjs bind-ag --title "你的对话标题"
node bridge.mjs bind-codex 019xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
node bridge.mjs status --json
```

打开控制面板：

```bash
node server.mjs                 # http://127.0.0.1:4319
```

## 架构

```
用户 ──► 本地面板 (127.0.0.1:4319) ──► AG Pilot CLI + HTTP API
                                            │
                            ┌────────────────┼────────────────┐
                            ▼                ▼                ▼
                       state.json     CDP → Antigravity   IPC → Codex
                      (分组绑定)       (端口 9333)        (Unix socket)
```

一个职责：找到选中的分组、定位绑定目标、通过正确的本地通道路由。

## 命令行

| 命令 | 用途 |
| --- | --- |
| `bridge.mjs status --json` | CDP、IPC 和路由状态 |
| `bridge.mjs bind-ag --title "T"` | 绑定分组到 Antigravity 对话 |
| `bridge.mjs bind-codex 019...` | 绑定分组到 Codex 线程 |
| `bridge.mjs ag-list` | 列出可见的 Antigravity 对话 |
| `bridge.mjs ag-send --text "消息"` | 向绑定的 Antigravity 对话发消息 |
| `bridge.mjs codex-send --text "消息"` | 向绑定的 Codex 线程发消息 |
| `bridge.mjs ag-to-codex` | 把 Antigravity 最新回复转给 Codex |
| `bridge.mjs codex-to-ag` | 把 Codex 最新回复转给 Antigravity |

加 `--group "名称"` 指定分组。加 `--dry-run` 预览不发送。

## HTTP API

面板服务运行在 `127.0.0.1:4319`。

| 端点 | 用途 |
| --- | --- |
| `GET /api/snapshot` | 完整面板状态、绑定、健康信息 |
| `GET /api/codex-threads` | 本地数据库中的最近 Codex 线程 |
| `POST /api/groups/create` | 创建分组 |
| `POST /api/groups/delete` | 删除分组 |
| `POST /api/groups/switch` | 切换分组 + 选中 Antigravity 对话 |
| `POST /api/bind/ag` | 绑定分组到 Antigravity 标题 |
| `POST /api/bind/codex` | 绑定分组到 Codex 线程 |
| `POST /api/open-codex` | 打开绑定的 Codex 线程 |

## Telegram 远程控制

用手机控制 AG Pilot。

```bash
AG_TELEGRAM_TOKEN="token" AG_TELEGRAM_CHAT_ID="id" node telegram-bot.mjs
```

| 命令 | 作用 |
| --- | --- |
| *（直接打字）* | 发给 Antigravity，自动推送回复 |
| `/status` | CDP、分组、绑定、忙碌状态 |
| `/list` | 带编号的对话列表 |
| `/use <编号>` | 切换当前对话 |
| `/read` | Antigravity 最新回复 |
| `/peek` | Antigravity 截图 |
| `/pause` / `/resume` | 暂停/恢复消息路由 |
| `/stop` | 停止 Antigravity Agent（需确认） |
| `/help` | 所有命令 |

设置：通过 [@BotFather](https://t.me/BotFather) 创建 Bot，通过 [@userinfobot](https://t.me/userinfobot) 获取 chat ID。

## 配置

### CDP 端口

```bash
./scripts/setup-cdp.sh                    # 默认 9333
AG_CDP_PORT=9444 ./scripts/setup-cdp.sh   # 自定义端口
```

端口优先级：`AG_CDP_PORT` 环境变量 → `state.json` cdpPort → 默认 9333。

### 状态文件

绑定保存在 `state.json`（已 git 忽略）：

```json
{
  "groups": [{
    "name": "开源项目",
    "agTitle": "我的 Antigravity 对话",
    "codexThreadId": "019..."
  }]
}
```

## 环境要求

- macOS
- Node.js 22+
- 已启用 CDP 的 Antigravity
- 同一台 Mac 上已登录的 Codex App

## 开发

```bash
npm test          # 72 个测试
npm run lint      # eslint
node server.mjs   # 本地面板
```

## 安全

- 只与本地 CDP 和本地 IPC 通信。除 Telegram（可选）外无网络请求。
- 绑定是显式的。目标缺失 = 命令失败。
- 状态和日志已 git 忽略。
- 面板只在 localhost 提供服务。

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。欢迎提 Issue 和 PR。

## 协议

[MIT](LICENSE)
