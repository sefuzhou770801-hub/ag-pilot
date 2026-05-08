# Contributing

Issues and pull requests are welcome.

## Development

```bash
git clone https://github.com/sefuzhou770801-hub/ag-pilot.git
cd ag-pilot
cp state.example.json state.json
node --test test/*.test.mjs
```

## Commit Messages

Use Chinese commit messages:

- 新增：新功能
- 修复：bug 修复
- 整理：代码清理、重构
- 文档：文档更新

## Pull Requests

1. Fork the repo and create a branch from `main`.
2. Add tests if you add code.
3. Run `npm test` and ensure all tests pass.
4. Submit your PR with a clear description of what changed and why.

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- The command or card action you used
- What you expected
- What actually happened
- Output of `node bridge.mjs status --json`
