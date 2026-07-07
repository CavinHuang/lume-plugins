# Obsidian Bridge 图谱能力完善设计

- **日期**:2026-07-07
- **状态**:已批准,待实现
- **范围**:`plugins/obsidian-bridge`
- **协议版本**:保持 v1(向前兼容,不升 major)
- **来源**:brainstorming 会话决议

---

## 1. 背景与问题

### 1.1 现状架构

Obsidian Bridge 是双端架构,四层代码逻辑完整且都有单测:

```
Lume/Claude 侧(MCP server, Node 进程)
   ↕  本地 HTTP  127.0.0.1:43112
Obsidian 侧(插件, Electron renderer 进程)
   ├── http-router.ts    路由 + 协议协商 + 信任拦截
   ├── vault-service.ts  真正调 Obsidian API (vault / metadataCache)
   └── server.ts         node:http 起服务
```

MCP 工具层(`tools.ts`)已注册 9 个工具:`bridge_status` / `pair_with_code` / `forget_pairing` / `read_note` / `search_notes` / `upsert_note` / `delete_note` / `get_metadata` / `backlinks` / `read_palace` / `list_notes` / `vault_diagnostics`。

### 1.2 "不能用"根因核查结论

用户反馈 `list_notes` / `upsert_note` 等工具"不能用"。经客观核查:

| 核查项 | 结论 |
|---|---|
| 配对是否正常 | ✅ 正常(说明 HTTP 桥通、`node:http` 在 Obsidian renderer 可用) |
| `dist/mcp.js` 工具注册 | ✅ 9 个工具全在 |
| `dist/main.js` 路由/实现 | ✅ 含 `q.list` / `/diagnostics` / `resolvedLinks` / `unresolvedLinks` |
| 构建时间 | ✅ dist(2026-07-06) 晚于源码(2026-07-04/05) |

**排除**:传输层(`node:http`)、bundle 未重建、配对流程。

**根因锁定在运行时两端**:
1. **信任策略不可操作**:`upsert_note` 写 `people/` / `projects/` / `wiki/` 等长期记忆区返回 409 `needs_confirmation`,必须带 `confirmed=true`。但 MCP 工具层只把裸 409 透传给 AI,AI 把它当死胡同——这是 `upsert_note`"不能用"的头号元凶。
2. **`vault-service` 实现脆弱**:
   - `read(path)` 对不存在路径 `getAbstractFileByPath(path)!` 裸抛
   - `metadata` 的 `mtime` / `ctime` 恒为 0
   - `backlinks` 只查 `resolvedLinks`,漏掉 `unresolvedLinks`(断链)
   - `search` 是全量 `indexOf`,无相关度、无类型过滤、返回无时间戳

### 1.3 用户需求

1. **修复**:让现有 9 个工具真正健壮可用。
2. **建立关联图谱**:让 AI 能建立笔记间的关联。
3. **通过图谱找笔记**:基于图谱结构查询相关笔记。

---

## 2. 目标与非目标

### 目标

- **P0**:现有工具健壮可用(防御性 `vault-service` + 可操作错误信息 + 文档对齐)。
- **P1**:图谱查询基础——邻居遍历(N 跳) + 最短路径。
- **P2**:结构分析——hub / 孤岛 / 桥节点。
- **P3**:相似推荐(共邻居 Jaccard) + 关系类型化(`frontmatter.links`)。

### 非目标(YAGNI 边界)

- ❌ 不引入图数据库或第三方图谱库(纯内存遍历足够)。
- ❌ 不做图谱可视化(Obsidian 原生图谱已覆盖)。
- ❌ 不做嵌入向量相似度(Jaccard 共邻居在稀疏图阶段足够)。
- ❌ 不升协议 major 版本(全是向前兼容的新增)。
- ❌ 不在本轮重写信任策略本身(仅增强错误可操作性)。

---

## 3. 核心决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 图谱建模 | **wiki 链接为主 + 可选 frontmatter 类型化** | 复用 `resolvedLinks`,起步零额外存储;原生图谱/手机端/其他插件均可见;类型化渐进可选 |
| 关系类型化载体 | `frontmatter.links: [{to, type}]` | 与 wiki link 并存;查询时与 `resolvedLinks` 合并 |
| 图查询数据源 | `metadataCache.resolvedLinks` + `unresolvedLinks` + `frontmatter.links` | Obsidian 现成邻接表,毫秒级遍历 |
| 交付节奏 | **全量分 4 Phase**(P0→P1→P2→P3) | 覆盖全部需求;每 Phase 独立可验证、随时可停 |
| 协议版本 | 保持 v1 | 新增端点 + 可选字段,无破坏性变更 |

---

## 4. 设计

### 4.1 协议与端点(向前兼容)

**版本策略**:`PROTOCOL_VERSION` 保持 `1`。新增端点与可选字段不影响旧客户端。

**新增端点**(均需鉴权,走 `/graph/` 子路径,复用 `/palace/:room` 的前缀匹配先例):

| 方法 | 路径 | 入参 | 返回 | Phase |
|---|---|---|---|---|
| GET | `/graph/neighbors` | `path`, `depth`(≤3), `direction=fwd\|back\|both` | `{nodes:[{path, depth, via}]}` | P1 |
| GET | `/graph/path` | `from`, `to` | `{path:[...], hops:n}` 或 `{path:[], hops:0}` | P1 |
| GET | `/graph/structure` | `scope?`(路径前缀), `top?`(hub 数,默认 10) | `{hubs:[...], orphans:[...], bridges:[...]}` | P2 |
| GET | `/graph/similar` | `path`, `limit` | `{similar:[{path, score}]}` | P3 |

`ENDPOINTS` 常量与 `protocol.md` 一并补登 `/notes?list`、`/diagnostics`、`/graph/*`(顺手修复文档漂移)。

### 4.2 核心纯函数模块 `graph-engine.ts`(隔离重点)

新增 `src/obsidian-app/graph-engine.ts`——**纯函数,零 Obsidian 依赖,输入邻接表输出结果**。

```ts
// 双向化后的无向图邻接表
type Adjacency = Record<string, Set<string>>;

// N 跳邻居遍历(BFS),direction 控制用出边/入边/双向
neighbors(adj, start, depth, direction): { path: string; depth: number; via: string }[];

// 最短路径(BFS),找不到返回 []
shortestPath(adj, from, to): string[];

// 结构分析:hub(度数 top-N,默认10)、orphans(零度)、bridges(DFS 桥边算法,返回边)
structure(adj, top?): { hubs: string[]; orphans: string[]; bridges: { from: string; to: string }[] };

// 相似推荐:共邻居 Jaccard,可选共标签加权
similar(adj, tagMap, path, limit): { path: string; score: number }[];
```

**为何独立**(SOLID 的 S 与 D):
- 图算法的正确性与 Obsidian 无关,独立后可密集单测各种拓扑(链/环/星/孤岛)。
- `vault-service` 退化为"Obsidian API → 邻接表"的薄适配层。
- 将来换数据源(如 Bases/属性)只改适配层,算法不动——高层策略不依赖底层细节。

### 4.3 各 Phase 组件变更

| Phase | 改动文件 | 关键内容 |
|---|---|---|
| **P0 修复** | `vault-service.ts` | null 安全(`getAbstractFileByPath` 返回 null 时返回 `not_found` 而非裸抛);`metadata` 用 `file.stat.mtime/ctime` 取真实时间戳;`backlinks` 合并 `unresolvedLinks`;`search` 返回 mtime + 支持 `type` 过滤 |
| | `http-router.ts` + `tools.ts` | 409 `needs_confirmation` 错误体带可操作指引(路径 + "带 `confirmed=true` 重试") |
| | `main.ts`(health) | `appVersion` 从 `manifest.json` 读取,不写死 `0.1.1` |
| | `protocol.ts` + `protocol.md` | 补登 `/notes?list`、`/diagnostics`、`/graph/*` |
| **P1** | `graph-engine.ts`(新) | `neighbors` + `shortestPath` |
| | `vault-service.ts` | `buildAdjacency()`(`resolvedLinks` 双向化)+ `graphNeighbors` / `graphPath` |
| | `http-router.ts` + `obsidian-client.ts` + `tools.ts` | `/graph/neighbors`、`/graph/path` 全链路 |
| **P2** | `graph-engine.ts` | `structure`(hub=度数 top-N、orphans=零度、bridges=DFS 桥算法) |
| | 全链路 | `/graph/structure` + `graph_structure` 工具 |
| **P3** | `graph-engine.ts` | `similar`(共邻居 Jaccard,可选共标签加权) |
| | `vault-service.ts` | `buildAdjacency` 合并 `frontmatter.links`(类型化的边) |
| | `tools.ts` | `graph_similar` + `link_notes(from, to, type?)`(语义化建边:`type` 空→插 `[[to]]` wiki link;`type` 非空→写 `frontmatter.links`) |

### 4.4 数据流

**查询流**(以 `graph_neighbors` 为例):

```
AI 调 graph_neighbors(path, depth)
 → MCP tools.ts → client.graphNeighbors
 → GET /graph/neighbors?path=&depth=&direction=
 → router → vaultService.graphNeighbors
 → buildAdjacency(metadataCache)   ← 现场构建,毫秒级,无持久化
 → graph-engine.neighbors(adj,...) ← 纯函数
 → 原路返回 {nodes:[...]}
```

**建边流**(P3 类型化):

```
AI 调 link_notes("projects/X.md", "people/张三.md", "owner")
 → patch frontmatter: links:[{to:"people/张三.md", type:"owner"}]
 → (受信任策略约束:写 people/ 需 confirmed)
 → 之后 graph_neighbors 自动合并该边(resolvedLinks + frontmatter.links)
```

### 4.5 错误处理与边界

| 场景 | 处理 |
|---|---|
| 起点/终点笔记不存在 | 返回 `not_found`(404) |
| `graph_path` 找不到路径 | 返回 `{path:[], hops:0}`(**不报错**——"没路径"是有效结果) |
| `depth > 3` | 服务端 clamp 到 3(防邻接爆炸、超时) |
| 图为空(vault 无链接) | `neighbors` 返回空、`structure` 全员 orphans、`similar` 返回空——均不报错 |
| 写受保护区(people/ 等) | 复用现有 409 + `X-Confirmed`;P0 增强为可操作错误信息 |
| 超大 vault 遍历性能 | `buildAdjacency` 每次查询重建 O(V+E);vault <10k 笔记可接受;预留 `scope` 参数做前缀裁剪 |

### 4.6 测试策略

- **`graph-engine.test.ts`(新,重点)**:纯函数,覆盖链/环/星/孤岛/不连通/自环等拓扑,断言 `neighbors` 各 depth、`shortestPath` 最短性、`structure` 的 hub/bridge 判定、`similar` 的 Jaccard 分数。不依赖 Obsidian,跑得快、测得全。
- **`vault-service.test.ts`(扩展)**:用 mock `ObsidianApp`(复用现有 backlinks 测试的 mock 模式)验证 `buildAdjacency` 正确翻译 `resolvedLinks` / `unresolvedLinks` / `frontmatter.links`。
- **`http-router.test.ts`(扩展)**:新增 `/graph/*` 端点的路由 + 鉴权 + 协议协商测试,复用现有模式。
- **`mcp-tools.test.ts`(扩展)**:验证 P0 的 `needs_confirmation` 可操作错误信息。
- **回归**:现有 13 个测试文件全绿不得破坏。

---

## 5. Phase 交付计划与验收标准(DoD)

### P0 · 修复现有工具
- [ ] `list_notes` / `upsert_note` / `read_note` 在受保护路径、不存在路径、空 prefix 下行为正确且有明确错误。
- [ ] 409 `needs_confirmation` 返回可操作指引(含路径与重试方法)。
- [ ] `metadata` 返回真实 `mtime` / `ctime`(非 0)。
- [ ] `backlinks` 含断链(`unresolvedLinks`)。
- [ ] `health` 的 `appVersion` 来自 `manifest.json`。
- [ ] `protocol.md` 与 `ENDPOINTS` 补登 `/notes?list`、`/diagnostics`、`/graph/*`。
- [ ] 现有 13 个测试全绿 + 新增 P0 测试。

### P1 · 邻居遍历 + 最短路径
- [ ] `graph-engine.ts` 的 `neighbors` / `shortestPath` 单测覆盖各拓扑。
- [ ] `graph_neighbors(path, depth, direction)` 工具端到端可用。
- [ ] `graph_path(from, to)` 工具端到端可用(找不到路径返回空数组)。
- [ ] `buildAdjacency` 正确双向化 `resolvedLinks`。

### P2 · 结构分析
- [ ] `structure` 单测覆盖 hub / orphans / bridges 判定。
- [ ] `graph_structure(scope?)` 工具端到端可用。

### P3 · 相似推荐 + 关系类型化
- [ ] `similar` 单测验证 Jaccard 分数排序。
- [ ] `buildAdjacency` 合并 `frontmatter.links`。
- [ ] `graph_similar(path, limit)` 工具端到端可用。
- [ ] `link_notes(from, to, type?)` 工具可用且受信任策略约束。
- [ ] 类型化端到端:`link_notes` 建边后 `graph_neighbors` 能看到该边。

---

## 6. 风险与开放问题

| 风险/问题 | 应对 |
|---|---|
| `buildAdjacency` 每次查询重建,超大 vault 可能慢 | 预留 `scope` 前缀裁剪;<10k 笔记先不缓存 |
| 桥边(bridges)的 DFS 算法在大赛群图上复杂度偏高 | P2 先实现标准 DFS 桥边算法;若性能不足,降级为"删去后连通分量数增加"的近似判定 |
| `frontmatter.links` 与 wiki link 并存可能冗余 | 查询时去重(同一 `(from,to)` 只计一次);`link_notes` 优先用 wiki link,仅当需类型时才写 frontmatter |
| Obsidian `file.stat` 在极少数笔记类型上可能缺失 | `metadata` 对 `stat` 缺失回退 0 并在测试中覆盖 |
| 类型化的 `type` 词表未约束 | P3 不强制词表,允许自由字符串;后续可按需收敛 |

---

## 7. 后续

本 spec 获批后,转入 `writing-plans` 技能,按 P0→P1→P2→P3 拆解为可执行的实现计划。
