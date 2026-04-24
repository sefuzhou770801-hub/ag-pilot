# CC Codex Bridge

本地桥接器，用来减少 Antigravity 和 Codex App 之间的手动复制粘贴。

## 核心命令

```bash
node /Users/zhousefu/.gemini/tools/cc-codex-bridge/bridge.mjs status --json
node /Users/zhousefu/.gemini/tools/cc-codex-bridge/bridge.mjs bind-codex 019xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
node /Users/zhousefu/.gemini/tools/cc-codex-bridge/bridge.mjs bind-cc --title "CC 对话标题"
node /Users/zhousefu/.gemini/tools/cc-codex-bridge/bridge.mjs cc-to-codex --dry-run
node /Users/zhousefu/.gemini/tools/cc-codex-bridge/bridge.mjs codex-to-cc --dry-run
node /Users/zhousefu/.gemini/tools/cc-codex-bridge/bridge.mjs cc-to-codex
node /Users/zhousefu/.gemini/tools/cc-codex-bridge/bridge.mjs codex-to-cc
```

## Stream Deck 第一版按钮

两个按钮先够用：

```bash
node /Users/zhousefu/.gemini/tools/cc-codex-bridge/bridge.mjs cc-to-codex
node /Users/zhousefu/.gemini/tools/cc-codex-bridge/bridge.mjs codex-to-cc
```

## 悬浮卡片

```bash
/Users/zhousefu/.gemini/tools/cc-codex-bridge/open-floating-card.sh
```

卡片地址：

```text
http://127.0.0.1:4319/
```

卡片会显示：

- 当前选中的 CC 对话
- 已绑定的 CC 对话
- 最近活跃的 Codex 对话
- 已绑定的 Codex 对话
- AutoAccept 和 Codex IPC 是否可用

## 边界

- Codex App 通过 `codex://threads/<threadId>` 保持可见。
- Codex 发送消息走本机 IPC。
- Antigravity 侧要求 AutoAccept 插件已安装，并使用它的 CDP 端口和选择器规则。
- 没有绑定目标时不会自动猜窗口。
