# Obsidian Bridge

把 Obsidian Vault 变成「第二大脑消化系统」。Lume 通过本地 HTTP 桥接读写/搜索/消化 Vault,按三层信任分层安全沉淀长期记忆。

## 能力(Phase 1)

- **MCP server**:`read_note` / `search` / `upsert_note` / `delete_note` / `get_metadata` / `backlinks` / `read_palace`。
- **信任分层**:`raw/` 只读;`memory/inbox/` 自由写;`people/` 等长期记忆区写入需确认。
- **Memory Palace**:`digest-note` 技能按 `palace/digest_note_room.md` 房间卡编排。
- **digest-note 技能**:消化笔记 → `memory/inbox/<date>.md`。

## Lume 市场设置流程

1. 将 Obsidian 端插件的 `main.js` 与 `manifest.json` 放入
   `<Vault>/.obsidian/plugins/obsidian-bridge/`,然后在 Obsidian 社区插件设置中启用。
2. 保持 Obsidian 打开,确认桥接插件监听 `127.0.0.1:43112`。
3. 在 Obsidian 插件设置页复制 10 分钟内有效的配对码。
4. 首次从 Lume 使用插件时,在弹窗中输入配对码完成绑定;之后请求会使用本地 token。

## 权限说明

| 权限 | 用途 |
|---|---|
| `network.outbound: 127.0.0.1:43112` | 仅连接本地 Obsidian 端桥接插件(127.0.0.1:43112),不联网外发 |

本插件**不**请求 `shell` 或 `filesystem`。所有 Vault 操作经本地 HTTP 桥接完成。

## 安装

### 1. Obsidian 端(配套桥接插件)
- 从仓库 Release 下载 `main.js` / `manifest.json`。
- 放入 `<Vault>/.obsidian/plugins/obsidian-bridge/`,在 Obsidian 设置→社区插件启用。
- 启用后在插件设置页查看「配对码」。

### 2. Lume 端
- 在 Lume 市场安装 `obsidian-bridge`,首次使用输入 Obsidian 显示的配对码完成绑定。
