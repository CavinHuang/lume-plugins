# obsidian-bridge 协议(Protocol v1)

Lume 端 ↔ Obsidian 端,本地 HTTP,`127.0.0.1:43112`。

## 请求约定
- 受保护端点必须带 `Authorization: Bearer <token>` 与 `X-Protocol-Version: 1`。
- 需确认区写入须额外带 `X-Confirmed: true`。

## 端点
| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | /health | 否 | 探测 + 协议/vault 名 |
| POST | /pair | 否(配对码) | 配对码换 token |
| GET | /notes?path= | 是 | 读笔记 |
| POST | /notes | 是 | 创建/覆盖(信任分级) |
| PATCH | /notes | 是 | 部分更新 |
| DELETE | /notes?path= | 是 | 删除 |
| GET | /search?q=&type=&limit= | 是 | 全文/标签/路径检索 |
| GET | /metadata?path= | 是 | 标签/属性/时间 |
| GET | /backlinks?path= | 是 | 反链 |
| GET | /palace/:room | 是 | 读房间卡 |
| GET | /events | 是 | SSE 事件流(Phase 2) |

## 错误码
`bridge_unreachable` / `token_invalid` / `vault_mismatch` / `protocol_mismatch` / `raw_readonly` / `needs_confirmation` / `not_found` / `merge_conflict`

## 三层信任分层
| 区 | 路径前缀 | 写入 |
|---|---|---|
| 原始证据 | `raw/` | 只读(403) |
| 影子 / 待审 / 反馈 | `sources/` `memory/inbox/` `memory/feedback/` | 自由写 |
| 长期记忆 | `people/` `projects/` `wiki/` `decisions/` `daily/` `palace/` 及 `profile.md` `vault.md` `style.md` `memory_policy.md` | 需确认(409 → `X-Confirmed`) |
