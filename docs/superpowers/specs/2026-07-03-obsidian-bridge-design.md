# obsidian-bridge:第二大脑消化系统插件设计

- **日期**:2026-07-03
- **仓库**:`CavinHuang/lume-plugins`
- **插件名**:`obsidian-bridge`(`plugins/obsidian-bridge/`)
- **定位**:把 Obsidian Vault 变成「第二大脑消化系统」的 Lume 市场插件(含配套的 Obsidian 端桥接插件)
- **状态**:设计待评审

---

## 1. 背景与目标

Obsidian 是最适合做第二大脑的容器(本地、双链、图谱、活跃生态),但「缺一个消化系统」——笔记写完就躺平,占磁盘不占带宽。市面上的 Obsidian AI 插件几乎都在做同一件事:侧栏开一个 Agent 对话框,写文件/做总结/闲聊,没有系统化地**消化与沉淀**知识。

参考产品 `obsidian-cc`(looping-engineering/obsidian-cc)把一套验证过的「消化—沉淀—生长」引擎搬进 Obsidian:三层信任分层、Memory Palace、六大消化技能。但它是「Obsidian 内置 Agent 面板」(基于 Claude Code 内核),自带对话框/@引用//技能 UI。

**本插件的差异化定位**:Lume **本身已是 Agent**(内核 + 对话 + 技能菜单)。因此我们不重做 Agent,而是补 obsidian-cc 真正的灵魂——**Vault 侧的消化系统**(信任分层 + Memory Palace + 消化沉淀闭环),通过 Lume 市场 MCP 插件暴露给 Lume,让 Lume 成为 Vault 的第二大脑。

**目标**:在 Lume 插件市场收录一个 `obsidian-bridge` 插件(Lume 端 MCP server + 消化技能),配合一个轻量的 Obsidian 端桥接插件(本地 HTTP server + Vault 操作),让 Lume 能读写/搜索/消化 Vault,并按信任分层安全沉淀长期记忆。

---

## 2. 范围与非目标

**范围内(MVP)**:
- Obsidian 端桥接插件:本地 HTTP server(REST + SSE)、鉴权配对、Vault CRUD/搜索/元数据/反链、命令执行(白名单)。
- 三层信任分层目录契约 + 按路径写入分级 + 请求级确认门。
- Memory Palace 房间卡读取(作为消化技能 SOP 源)。
- 五个消化技能:`digest-note` / `review-inbox` / `apply-memory` / `update-profile` / `vault-doctor`(`create-skill` 由 Lume 原生能力覆盖)。
- 单 Vault 模式(`token ↔ vaultName` 绑定)。
- 双端分阶段实现:Phase 1 跑通 `digest-note` 闭环,Phase 2 补其余技能(见 §13)。

**非目标(YAGNI)**:
- 不在 Obsidian 端做 Agent 对话面板 / @引用 / /技能 UI——由 Lume 原生覆盖。
- 不做向量库 / RAG embedding——记忆调取走 Memory Palace「存路线」,不走相似度检索。
- 不做多 Vault 并发(单 Vault 优先;多窗口端口冲突走降级提示)。
- 不做自签 TLS(MVP 用 localhost + token;后续可平滑升级,见 §5)。
- 不做 Obsidian 离线回退(Lume 端不声明 filesystem;一切走网络桥接)。
- 不上 obsidian.md 社区市场(后续选项,见 §15)。

---

## 3. 产品定位与职责切分

| obsidian-cc 的部分 | 本插件由谁承担 | 说明 |
|---|---|---|
| Claude Code 内核 + 对话面板 + @引用 + /技能菜单 | **Lume(已有)** | 不重做 |
| 三层信任分层 + 确认门 | **Obsidian 端** | 写入安全编码进目录结构 |
| Memory Palace 房间卡 | **Obsidian 端存储 + Lume 端按卡编排** | 房间卡 = 技能 SOP |
| 五大消化技能 | **Lume 端 skill + MCP 编排** | 流水线 |
| `create-skill` | **Lume 原生**(写入本插件 `skills/`) | 不另造 |

核心判断:Lume = Agent,Obsidian 端 = 消化系统。两者通过**版本化的本地 HTTP 协议**解耦。

---

## 4. 总体架构(方案 A:HTTP REST + SSE)

```
┌─────────────────┐   HTTP REST(请求-响应)     ┌──────────────────────┐
│   Lume / 任意    │   + SSE /events(推送)       │  Obsidian app        │
│   MCP 客户端     │ ◀─────────────────────────▶ │  └ obsidian-bridge   │
│        │        │   127.0.0.1:PORT            │     端插件            │
│        ▼        │   Authorization: Bearer     │  (本地 HTTP server)   │
│  obsidian-bridge│   X-Protocol-Version        │                      │
│   MCP server    │                             │  Vault(markdown)     │
└─────────────────┘                             └──────────────────────┘
   (Lume 市场插件)                                 (Obsidian 社区插件)
```

- **通道**:HTTP REST(请求-响应)+ SSE(单向事件推送)。SSE 比 WebSocket 简单,Lume 端用 Node fetch 即可,Obsidian 端用 Node `http` 原生支持。
- **鉴权**:localhost 绑定(`127.0.0.1`)+ 启动时生成的随机 token + 配对码换取流程。
- **演进性**:后续若需传输加密,仅需给 server 加 TLS(协议不动),可平滑升级。

---

## 5. 组件分解(每个职责单一、可独立测试)

| 组件 | 端 | 职责 | 依赖 |
|---|---|---|---|
| **obsidian-app**(Obsidian 端主) | Obsidian | Plugin 生命周期:load→起 server,unload→关 | Obsidian API、Node `http` |
| **http-router** | Obsidian | 路由分发 + 协议版本协商 + 统一错误序列化 | 纯函数 |
| **vault-service** | Obsidian | CRUD/搜索/元数据/反链/命令的业务逻辑 | Obsidian API |
| **trust-policy** | Obsidian | 按路径判定信任级(raw 只读 / 自由写 / 需确认)| 纯函数 |
| **palace** | Obsidian | 房间卡五段解析(触发/必读/条件读/输出/坑) | 纯函数 |
| **pairing-store** | Obsidian | 生成/校验配对码与 token、撤销 | 纯逻辑 |
| **mcp-server**(Lume 端主) | Lume | 把 MCP tool 调用翻译成 HTTP,把 SSE 事件转 MCP 通知 | MCP SDK、fetch |
| **obsidian-client** | Lume | 封装 HTTP 调用、token 管理、重试、协议版本头 | fetch(纯网络层) |
| **skills** | Lume | 五大消化技能的高层编排(调 mcp tools + 房间卡) | mcp-server |

**分层测试原则**:`http-router` / `trust-policy` / `pairing-store` / `obsidian-client` / 房间卡解析均设计为**不碰运行时的纯层**,可用普通 `node:test` 直接测,绕开「Obsidian 插件难自动化测试」问题(见 §12)。

---

## 6. 仓库与插件目录布局

```
plugins/obsidian-bridge/
├── lume-plugin.json            # Lume 清单:mcpServers + permissions(network)
├── README.md                   # 含「## 权限说明」逐项解释 + 双端安装
├── protocol.md                 # 双端协议契约文档(版本化端点的单一事实源)
├── package.json                # 该插件自身的依赖与构建脚本(esbuild)
├── src/
│   ├── mcp/                    # Lume 端 MCP server(独立 Node 进程)
│   │   ├── server.ts
│   │   ├── tools/              # read_note / search / upsert_note / delete_note / get_metadata / backlinks / execute_command / read_palace
│   │   └── obsidian-client.ts
│   └── obsidian-app/           # Obsidian 社区插件源码(构建为 main.js)
│       ├── main.ts             # Plugin 生命周期
│       ├── http-router.ts
│       ├── vault-service.ts
│       ├── trust-policy.ts
│       ├── pairing-store.ts
│       ├── palace.ts           # 房间卡五段解析
│       └── manifest.json       # Obsidian 插件清单(独立版本号)
├── skills/
│   ├── digest-note/SKILL.md
│   ├── review-inbox/SKILL.md
│   ├── apply-memory/SKILL.md
│   ├── update-profile/SKILL.md
│   └── vault-doctor/SKILL.md
└── tests/
    ├── protocol.test.mjs       # 共享协议契约
    ├── mcp.test.mjs            # mock HTTP server 测各 tool
    ├── trust-policy.test.mjs   # 信任分级判定(纯函数)
    └── palace.test.mjs         # 房间卡五段解析(纯函数)
```

Obsidian 端 `manifest.json` 有**独立版本号**,与 `lume-plugin.json` 解耦——两端通过 `X-Protocol-Version` 协商,而非版本号强绑。

---

## 7. 三层信任分层(数据模型根基)

插件初始化时在 Vault 创建固定目录契约:

```
raw/              原始证据(PDF/Word/截图)   只读 —— 结构性 403
sources/          Agent 影子 MD              自由写(可重做)
memory/inbox/     待审核沉淀                 自由写
memory/feedback/  👍/👎 反馈                  自由写
people/           人物长期记忆               写入需确认
projects/         项目长期记忆               写入需确认
wiki/             概念/知识沉淀              写入需确认
decisions/        决策记录                   写入需确认
daily/            日报                       写入需确认
palace/           任务路由房间卡             写入需确认
profile.md        我是谁                     写入需确认
vault.md          Vault 用途                 写入需确认
style.md          我的风格                   写入需确认
memory_policy.md  沉淀规则                   写入需确认
```

`POST/PATCH/DELETE /notes` 的行为由 `trust-policy` 按路径前缀决定。安全逻辑放在**最不可能被绕过的层**(文件系统路径),而非 HTTP 路由的 if-else:即便 Lume 端 bug 误调,Obsidian 端也会拦住对 `raw/` 与未确认长期记忆区的写入。

---

## 8. 协议设计

所有受保护端点必须带 `Authorization: Bearer <token>` 与 `X-Protocol-Version: 1`。

### 8.1 鉴权与配对流程

```
Obsidian 端                          Lume 端 MCP server
─────────────                        ──────────────────
1. 启动 → 生成 token + 6 位配对码
   设置页显示配对码(有效期 10min)
                        ──►  2. 用户在 Lume 输入配对码
                                  POST /pair {code} ──►
3. 校验码 → 返回 {token, vaultName}     ◄── {token, vaultName}
                        ◄──  4. 持久化「token ↔ vaultName」绑定
                                  后续请求带 Authorization: Bearer
```

- **token**:64 字节随机,启动时生成;Obsidian 设置页可「重置 token」即时失效旧 token。
- **配对码**:短期(10min)一次性。把"网络可达性"与"授权"分离——本机其他进程即便能连端口,没有配对码也拿不到 token。
- **vaultName 校验**:`/health` 返回当前 Vault 名;Lume 端每次重连校验与绑定一致,防止"用户换了 Vault 后旧 token 被复用导致操作错库"。

### 8.2 REST 端点

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/health` | 无需鉴权;返回 `{ok, protocol, appVersion, vaultName}` |
| POST | `/pair` | 配对码换 token(唯一非 Bearer 端点) |
| GET | `/notes?path=` | 读取笔记内容 + frontmatter |
| POST | `/notes` | 创建/覆盖笔记 `{path, content}`(按 trust-policy 分级) |
| PATCH | `/notes` | 部分更新(追加段落 / 改 frontmatter 字段) |
| DELETE | `/notes?path=` | 删除笔记 |
| GET | `/search?q=&type=&limit=` | 全文/标签/路径检索,返回命中片段 |
| GET | `/metadata?path=` | 标签、属性、创建/修改时间(走 `metadataCache`) |
| GET | `/backlinks?path=` | 反向链接列表(走 `resolvedLinks`) |
| POST | `/commands/:id` | 执行 Obsidian 内置命令(白名单) |
| GET | `/palace/:room` | 读取 Memory Palace 房间卡 |
| GET | `/events` | SSE 流:`note.changed` / `note.deleted` / `note.renamed` |

`PATCH /notes` 用"部分更新"而非全量覆盖:AI 改一段不擦掉用户同时编辑的别处。Obsidian 端做乐观合并,冲突返回 409。

### 8.3 SSE 事件流

```
GET /events  →  Content-Type: text/event-stream
event: note.changed
data: {"path":"daily/2026-07-03.md","mtime":17820...}

event: note.deleted
data: {"path":"archive/old.md"}
```

Lume 端 `obsidian-client` 维持一条 SSE 长连,断线指数退避重连;收到事件转成 MCP server 内部通知(供订阅型 skill 使用)。

### 8.4 协议版本协商

- 每个请求带 `X-Protocol-Version: 1`;`/health` 返回 Obsidian 端支持的协议版本。
- **主版本不匹配** → MCP tool 返回 `protocol_mismatch` 错误,明确提示升级哪一端;**次版本差异** → 向后兼容。

---

## 9. 确认门(请求级 dry-run,无状态两阶段)

对"需确认区"(people/projects/wiki/decisions/daily/palace/ + 四个根 .md)的写入:

- **不带** `X-Confirmed` 头 → Obsidian 端返回 `409 needs_confirmation` + 一份 dry-run 计划("将创建 people/张三.md / 追加 projects/X.md")。
- Lume 端把计划呈现给用户对话确认 → 重发带 `X-Confirmed: true` 才执行。

不引入 planId 持久化,保持无状态、易测、崩溃不留垃圾。代价是两次往返——对人工确认场景完全可接受(KISS 优先于节省一次 RTT)。

---

## 10. Memory Palace(存路线,不存知识)

不走向量库。`palace/` 存"房间卡",每张固定五段:

```
## 触发场景
## 必读(按顺序)
## 条件读
## 输出位置
## 坑 / 禁区
```

例:`palace/digest_note_room.md` 规定消化笔记前**必须**先读 `profile.md` → `vault.md` → `style.md` → 当前笔记;涉及人读 `people/<谁>.md`,涉及项目读 `projects/<什么>.md`;输出只能进 `memory/inbox/`。

落地:每个 Lume 端消化技能在执行**前先 `GET /palace/<room>`**,按"必读(按顺序)"连续调 `read_note`,按"输出位置"写入对应区。房间卡是编排约束(技能 SOP),不是相似度检索——与 MCP 工具编排天然契合。

---

## 11. 消化闭环技能(Lume 端)

| 技能 | 输入 → 输出 | 走确认门? |
|---|---|---|
| `digest-note` | 当前笔记/选区 → `memory/inbox/<date>.md` | 否(inbox 自由写) |
| `review-inbox` | 扫 `memory/inbox/` → 可确认清单(去重、标置信度/来源) | 否(只读 + 产清单) |
| `apply-memory` | 清单 → `people/` `projects/` `wiki/`(长期记忆) | **是** |
| `update-profile` | `memory/feedback/` → `profile.md` `style.md` | **是** |
| `vault-doctor` | 全 Vault 扫描 → 体检报告(raw 未消化/断链/孤儿) | 否(只读 + 产报告) |
| `create-skill` | 用户描述 → 新 skill 落到本插件 `skills/` | 由 Lume 原生确认 |

每个技能是一个 `SKILL.md` + 对应 MCP tool 编排。五技能串成「消化—沉淀—生长」流水线。

---

## 12. 错误处理

统一 `{error:{code, message, details?}}`;错误码用**稳定字符串**(Lume 端据此决定交互):

| 场景 | 状态码 | code | Lume 端处理 |
|---|---|---|---|
| Obsidian 未运行/插件未启用 | —(连接失败) | `bridge_unreachable` | 友好提示"请打开 Obsidian 并启用插件" |
| token 失效 | 401 | `token_invalid` | 提示重新配对 |
| Vault 已切换 | 401 | `vault_mismatch` | 提示重新确认当前 Vault |
| 协议主版本不匹配 | 426 | `protocol_mismatch` | 明确提示升级哪一端 |
| `raw/` 写入 | 403 | `raw_readonly` | 说明 raw/ 是原始证据区 |
| 需确认区未确认 | 409 | `needs_confirmation` | 附 dry-run 计划,引导确认 |
| 路径不存在 | 404 | `not_found` | — |
| PATCH 合并冲突 | 409 | `merge_conflict` | 提示用户手动解决 |
| 搜索无结果 | 200 | — | 返回空数组(非错误) |

---

## 13. 测试策略(对应分层)

- **纯函数层**(`http-router` / `trust-policy` / `pairing-store` / `obsidian-client` / `palace` 房间卡解析):`node:test` 单测,不碰运行时。**信任分级判定与房间卡解析可 100% 单测覆盖**——把安全与编排核心逻辑放在最易测的层。
- **Obsidian 端集成**:`vault-service` 用 mock Vault 对象测 CRUD/搜索/反链/确认门语义。
- **Lume MCP 端**:mock HTTP server(模拟 Obsidian 响应)测每个 tool 的请求构造与错误映射。
- **契约测试**:共享 TS 协议类型 + `protocol.test.mjs`,两端引用,防协议漂移。
- **跨端冒烟**:脚本起 mock Obsidian + Lume MCP,跑通 `digest-note` 全链路。
- **仓库门禁**:`npm test && npm run check:index`(CI 已有 `.github/workflows/validate.yml`)。

---

## 14. 权限声明(Lume 端 `lume-plugin.json`)

- `network`:连 `127.0.0.1:PORT`(Obsidian 桥接端点)——**唯一必需权限**,仅本地不联网外发。
- 不声明 `filesystem`(MVP 不做离线回退)、不声明 `shell`。
- README「## 权限说明」逐项解释 network 用途。

> **实现时确认项**:`network` 权限字段的确切 schema 需对照 Lume 消费端校验逻辑(`scripts/lib/manifest-rules.mjs` 镜像的函数)确认后填入清单,避免与市场索引校验冲突。

---

## 15. 交付与分发

| 端 | 产物 | 分发方式 |
|---|---|---|
| Obsidian 端 | `main.js` + `manifest.json` + `styles.css` | 仓库 Release 提供构建产物,README 教用户手动装入 `.obsidian/plugins/obsidian-bridge/` |
| Lume 端 | 市场插件(`lume-plugin.json` + MCP server) | 经本仓库 `marketplace.json`,Lume 市场安装 + 配对 |

Obsidian 端**不**走 obsidian.md 社区市场(审核周期长,且与 Lume 市场定位无关),作为后续选项。贡献流程遵循仓库根 CONTRIBUTING:复制 `example-hello` 模板 → 改名 → 写权限说明 → `npm run build:index` → `npm test` → `npm run check:index` → 开 PR。

---

## 16. MVP 范围与分阶段实现

MVP 范围偏大(完整消化系统),为控制实现节奏,分两阶段:

**Phase 1(最小可演示「消化」闭环)**:
- Obsidian 端:HTTP server + 配对 + Vault CRUD/搜索/元数据/反链 + 信任分层 + 确认门 + `/palace` 读取 + SSE。
- Lume 端:MCP server(全部基础 tool)+ `digest-note` 技能 + `palace/digest_note_room.md` 房间卡。
- 验收:能从 Lume 消化一篇笔记 → 写入 `memory/inbox/`,全程信任分级生效。

**Phase 2(补全消化闭环)**:
- `review-inbox` / `apply-memory` / `update-profile` / `vault-doctor` 四个技能 + 对应房间卡。
- SSE 事件驱动的增量消化。
- 验收:完整「消化—沉淀—生长」流水线可跑通。

---

## 17. 开放问题(实现时确认)

1. **`network` 权限 schema**:对照 Lume 消费端校验逻辑确认字段格式(见 §14)。
2. **命令白名单**:Obsidian 端 `/commands/:id` 暴露哪些命令——需定一份最小白名单(默认空,按需加),避免任意 UI 操作权。
3. **大 Vault 搜索性能**:MVP 用 `getMarkdownFiles()` + 内存匹配;万级笔记需评估是否上索引(延后)。
4. **MCP server 进程模型**:独立 Node 进程 vs 进程内,影响 `mcpServers` 声明的 `command`/`args`(默认独立进程)。
5. **Obsidian 端测试夹具**:mock Vault 对象的建立方式(是否引入 obsidian-md 的测试工具,或自建最小 stub)。
