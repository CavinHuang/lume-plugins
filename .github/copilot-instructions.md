# Copilot 评审指引 — lume-plugins 官方插件市场

评审每个 PR 时,除通用代码质量外,重点检查以下项。

## 安全(最高优先级,发现即标红)
- `eval` / `new Function(` / `child_process.exec` 拼接输入、动态下载并执行代码。
- 外发用户数据:硬编码外部 URL、向非知名域名 `fetch`/`http`、读取 `~/.lume` 或环境变量后外传。
- 混淆代码、大段不可读 base64 payload、无必要的 native/bin 二进制。

## 权限最小化
- 清单请求 `shell.allow` / 非空 `network.outbound` / 宽 `filesystem.write`(如 `./**`)时,README 必须有 `## 权限说明` 段逐项解释,否则标红。
- 指出 `tools.deny` 移除危险工具的影响。

## 结构
- 目录名必须等于 `lume-plugin.json` 的 `name`。
- 必须有 `LICENSE` 和 `README.md`。
- `source` 路径必须 `./` 开头、无 `..`。

## 不要做
- 不建议改动 `.lume-plugin/marketplace.json`——它是 `scripts/build-index.mjs` 的生成物。
- 不要求加无谓的抽象/配置项。
