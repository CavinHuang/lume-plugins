# Obsidian Bridge

把 Obsidian Vault 变成「第二大脑消化系统」。Lume 通过本地 HTTP 桥接读写/搜索/消化 Vault,按三层信任分层安全沉淀长期记忆。

## 能力

- **MCP server**:`bridge_status` / `pair_with_code` / `forget_pairing` / `read_note` / `search_notes` / `upsert_note` / `delete_note` / `get_metadata` / `backlinks` / `read_palace`。
- **图谱工具**:在 wiki-link 邻接图上回答结构问题——`graph_neighbors`(N 跳邻居,可指定 fwd/back/both)、`graph_path`(最短路径)、`graph_structure`(hub/orphan/桥边)、`graph_similar`(共邻居 Jaccard 相似);`link_notes` 写入关系(无 type 追加 `[[to]]` wiki 链,带 type 则在 frontmatter `links:[{to,type}]` 记录类型化边)。
- **信任分层**:`raw/` 只读;`memory/inbox/` 自由写;`people/` 等长期记忆区写入需确认。
- **Memory Palace**:`digest-note` 技能按 `palace/digest_note_room.md` 房间卡编排。
- **digest-note 技能**:消化笔记 → `memory/inbox/<date>.md`。

> P0 修复:`get_metadata`/`search_notes` 返回真实 `mtime`(取自 `file.stat`,不再假时间戳);写入受保护区返回 `409 needs_confirmation` 并附可执行提示,Agent 据此请求用户确认后带 `confirmed=true` 重试。

## Lume 市场设置流程

1. 将 Obsidian 端插件的 `main.js` 与 `manifest.json` 放入
   `<Vault>/.obsidian/plugins/obsidian-bridge/`,然后在 Obsidian 社区插件设置中启用。
2. 保持 Obsidian 打开,确认桥接插件监听 `127.0.0.1:43112`。
3. 在 Obsidian 插件设置页复制 10 分钟内有效的配对码。
4. 在 Lume 插件详情页点击「在对话中试用」或手动输入 `$obsidian-bridge 帮我检查 Obsidian 连接状态。`
5. 首次使用时把 Obsidian 显示的配对码发给 Lume,Agent 会调用 `pair_with_code` 完成绑定;之后请求会使用本地 token。

## 权限说明

| 权限 | 用途 |
|---|---|
| `mcpServers.register: true` | 注册本插件的 Obsidian MCP server,暴露配对和 Vault 工具 |
| `network.outbound: 127.0.0.1:43112` | 仅连接本地 Obsidian 端桥接插件(127.0.0.1:43112),不联网外发 |

本插件**不**请求 `shell` 或 `filesystem`。所有 Vault 操作经本地 HTTP 桥接完成。

## 安装

### 1. Obsidian 端(配套桥接插件)
- 从仓库 Release 下载 `main.js` / `manifest.json`。
- 放入 `<Vault>/.obsidian/plugins/obsidian-bridge/`,在 Obsidian 设置→社区插件启用。
- 启用后在插件设置页查看「配对码」。

### 2. Lume 端
- 在 Lume 市场安装并启用 `obsidian-bridge`。
- 在插件详情页点击「在对话中试用」,或在任意对话中输入 `$obsidian-bridge` 激活插件说明。
- 如果 `bridge_status` 显示 `pairingRequired`,把 Obsidian 设置页显示的配对码发给 Lume;Agent 会调用 `pair_with_code`。工具结果不会返回或展示 token。
