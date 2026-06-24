# Example Hello

Lume 插件市场的**示例插件**,也是贡献者模板。演示标准目录结构、skill / hook / mcp 三种能力接线,以及权限说明的写法。

## 能力

- **Skill**:`hello-world` — 一个最小可用的示例技能。
- **Hook**:`SessionStart` 时打印一行日志(结构演示)。
- **MCP**:`echo` 演示服务器(结构演示)。

## 权限说明

| 权限 | 用途 |
|---|---|
| `filesystem.read: ./**` | 读取插件自身目录资源 |
| `filesystem.write: ./data/**` | 演示写权限——把会话产物写入 `./data/`(实际插件按需声明) |

本插件**不**请求 `shell` 或 `network`。真实插件请遵循最小权限原则:仅在确实需要时声明,并在此逐项解释。

## 安装

通过 Lume「插件 & 技能市场」UI 安装,或参见仓库根 README 订阅官方市场源。
