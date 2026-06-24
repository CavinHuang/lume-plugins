# 贡献指南

本仓库是 Lume 官方精选市场。欢迎通过 PR 提交插件或独立技能。

- **提交规范**:每个 PR 一个插件/技能,目录名与清单 `name` 一致。
- **权限最小化**:仅在确实需要时声明 `shell`/`network`/`write`,并在 README `## 权限说明` 逐项解释。
- **索引**:`.lume-plugin/marketplace.json` 是生成物,运行 `npm run build:index` 更新,勿手改。
- **本地校验**:`npm test && npm run check:index` 须通过。
- **审核**:核心团队人工审核 + Copilot AI 初筛,依据 [docs/REVIEW_CHECKLIST.md](./docs/REVIEW_CHECKLIST.md)。

完整步骤见 [docs/SUBMISSION_GUIDE.md](./docs/SUBMISSION_GUIDE.md)。
