# Obsidian Bridge 图谱能力完善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 obsidian-bridge 现有工具的运行时缺陷,并新增基于笔记图谱的邻居遍历、最短路径、结构分析、相似推荐四类查询能力。

**Architecture:** 在 Obsidian 端新增纯函数模块 `graph-engine.ts`(零 Obsidian 依赖的图算法),`vault-service.ts` 退化为"Obsidian `metadataCache` → 邻接表"的薄适配层。图谱查询经现有 HTTP 桥(`GET /graph/*`)暴露为 MCP 工具。建模以 wiki 链接为主、frontmatter `links` 为可选类型化补充。

**Tech Stack:** TypeScript、`node:test` + `node:assert/strict`(经 `tsx --test`)、esbuild(双产物 `dist/main.js` / `dist/mcp.js`)、`@modelcontextprotocol/sdk`、Obsidian Plugin API(`vault` / `metadataCache`)。

## Global Constraints

- **Git 提交策略(用户全局约定)**:本计划**不自动执行任何 git 命令**。每个任务以 "Checkpoint(不自动提交)" 收尾——运行全套测试、列出变更文件,然后**暂停等待用户显式批准**是否提交。任务边界仍按"可提交工作单元"切分,便于批准后逐任务提交。
- **命令约定**:项目遵循 RTK 约定(命令前缀 `rtk`)。本计划为可读性省略 `rtk` 前缀;执行时 `rtk npx tsx ...` 等价 passthrough。测试命令:`npx tsx --test tests/<file>.test.ts`(单文件)、`npm test`(全套)。
- **协议版本**:`PROTOCOL_VERSION` 保持 `1`(向前兼容,不升 major)。
- **测试不得回归**:现有 13 个测试文件在每个任务 Checkpoint 必须全绿。
- **构建产物**:涉及 Obsidian 端(`src/obsidian-app/**`)改动后,需 `npm run build:obsidian` 重建 `dist/main.js`;涉及 MCP 端(`src/mcp/**`)改动后,需 `npm run build:mcp` 重建 `dist/mcp.js`。Checkpoint 前执行相应构建。
- **代码注释语言**:与现有代码库一致,使用中文注释。
- **YAGNI 边界**:不引入图数据库/第三方图谱库;不做图谱可视化;相似度用 Jaccard 共邻居(不做嵌入向量)。

---

## Phase 0 — 修复现有工具

### Task 1: vault-service 健壮性(真实时间戳 + backlinks 含断链 + read 防 null)

**Files:**
- Modify: `src/obsidian-app/vault-service.ts` — `ObsidianApp` 接口、`metadata`、`backlinks`、`read`
- Test: `tests/vault-service.test.ts`(扩展)

**Interfaces:**
- Consumes: `ObsidianApp`(已有)
- Produces: `metadata()` 返回真实 `mtime`/`ctime`(来自 `file.stat`);`backlinks(path)` 同时覆盖已解析反链与断链反链

- [ ] **Step 1: 扩展 mockApp 与失败测试**

在 `tests/vault-service.test.ts` 末尾追加(`mockApp` 已提供 `mtime`/`ctime` 字段,需让其流经 `file.stat`):

```ts
// 先升级 mockApp:让 getAbstractFileByPath 返回带 stat 的文件对象
// (替换 mockApp 内 getAbstractFileByPath 一行)
getAbstractFileByPath: (p: string) =>
  store.has(p) ? { path: p, stat: { mtime: store.get(p)!.mtime!, ctime: store.get(p)!.ctime } } : null,
```

追加测试:

```ts
test("metadata 返回真实 mtime/ctime(来自 file.stat)", async () => {
  const app = mockApp({ "a.md": { content: "x", mtime: 7777 } });
  const s = createVaultService(app);
  const m = await s.metadata("a.md");
  assert.equal(m.mtime, 7777);
  assert.equal(m.ctime, 500); // mockApp 默认 ctime
});

test("backlinks 同时返回断链(unresolvedLinks)反链", async () => {
  const app = mockApp(
    { "a.md": { content: "x" }, "b.md": { content: "[[a]]" }, "c.md": { content: "[[ghost]]" } },
    {
      resolvedLinks: { "b.md": { "a.md": 2 } },
      unresolvedLinks: { "c.md": ["ghost"] },
    },
  );
  const s = createVaultService(app);
  // a.md 存在 → resolved 反链
  const bl = await s.backlinks("a.md");
  assert.equal(bl.length, 1);
  assert.equal(bl[0].fromPath, "b.md");
  // ghost 不存在 → 断链反链
  const ghost = await s.backlinks("ghost");
  assert.equal(ghost.length, 1);
  assert.equal(ghost[0].fromPath, "c.md");
});

test("metadata 对不存在文件返回空且不抛", async () => {
  const app = mockApp({});
  const s = createVaultService(app);
  const m = await s.metadata("missing.md");
  assert.deepEqual(m.tags, []);
  assert.deepEqual(m.frontmatter, {});
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test tests/vault-service.test.ts`
Expected: 3 个新测试 FAIL(`m.mtime` 为 0、`backlinks("ghost")` 为空、其余依实现而定)。

- [ ] **Step 3: 实现——更新 `ObsidianApp` 接口与三个方法**

在 `src/obsidian-app/vault-service.ts` 中:

(a) `ObsidianApp.vault.getAbstractFileByPath` 返回类型加 `stat`:

```ts
interface ObsidianApp {
  vault: {
    getAbstractFileByPath(p: string): { path: string; stat?: { mtime: number; ctime: number } } | null;
    read(f: { path: string }): Promise<string>;
    create(p: string, c: string): Promise<{ path: string }>;
    modify(f: { path: string }, c: string): Promise<void>;
    delete(f: { path: string }): Promise<void>;
    getMarkdownFiles(): { path: string; stat?: { mtime: number; ctime: number } }[];
  };
  metadataCache: { /* 不变 */ };
}
```

(b) `metadata` 使用 `file.stat`,且对文件不存在不抛:

```ts
async metadata(path) {
  const f = app.vault.getAbstractFileByPath(path);
  const cache = f ? app.metadataCache.getFileCache(f) : null;
  const tags = cache?.tags ? Object.keys(cache.tags).map((t) => t.replace(/^#/, "")) : [];
  return {
    tags,
    frontmatter: cache?.frontmatter ?? {},
    mtime: f?.stat?.mtime ?? 0,
    ctime: f?.stat?.ctime ?? 0,
  };
}
```

(c) `backlinks` 合并 `unresolvedLinks`:

```ts
async backlinks(path) {
  const target = path.replace(/\.md$/, "");
  const out: { fromPath: string; occurrences: number }[] = [];
  // 已解析反链
  for (const [src, links] of Object.entries(app.metadataCache.resolvedLinks)) {
    for (const [tgt, count] of Object.entries(links)) {
      if (tgt === path || tgt.replace(/\.md$/, "") === target) {
        out.push({ fromPath: src, occurrences: count });
      }
    }
  }
  // 断链反链(有人 [[path]] 但 path 不存在)
  for (const [src, links] of Object.entries(app.metadataCache.unresolvedLinks)) {
    for (const link of links) {
      if (link === path || link === target || link.replace(/\.md$/, "") === target) {
        out.push({ fromPath: src, occurrences: 1 });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test tests/vault-service.test.ts`
Expected: 全部 PASS(含原有 6 个 + 新增 3 个)。

- [ ] **Step 5: Checkpoint(不自动提交)**

Run: `npm run build:obsidian && npm test`
Expected: 构建成功,全套测试 PASS。
变更文件:`src/obsidian-app/vault-service.ts`、`tests/vault-service.test.ts`、`dist/main.js`(构建产物)。
按约定**不自动提交**,等待用户确认。

---

### Task 2: search 增强(返回 mtime + 让 type 参数生效)

**Files:**
- Modify: `src/obsidian-app/vault-service.ts` — `search`
- Modify: `src/obsidian-app/http-router.ts` — `VaultService.search` 返回类型
- Modify: `src/mcp/obsidian-client.ts` — `search` 返回类型
- Test: `tests/vault-service.test.ts`(扩展)

**Interfaces:**
- Consumes: `VaultService.search(q, {type?, limit?})`(已有签名,type 之前被忽略)
- Produces: 每条 hit 含 `mtime`;`type:"tag"` 时按标签过滤

- [ ] **Step 1: 写失败测试**

在 `tests/vault-service.test.ts` 追加:

```ts
test("search 返回 mtime", async () => {
  const app = mockApp({ "x.md": { content: "hello", mtime: 4242 } });
  const s = createVaultService(app);
  const hits = await s.search("hello", {});
  assert.equal(hits[0].mtime, 4242);
});

test("search type=tag 按标签过滤", async () => {
  const app = mockApp({
    "a.md": { content: "x", tags: ["proj/lume"] },
    "b.md": { content: "x", tags: ["other"] },
  });
  const s = createVaultService(app);
  const hits = await s.search("lume", { type: "tag" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, "a.md");
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test tests/vault-service.test.ts`
Expected: FAIL(`hits[0].mtime` 为 undefined;type=tag 未生效)。

- [ ] **Step 3: 实现 search**

`search` 的 hit 类型新增 `mtime`;`type:"tag"` 时按 `metadataCache` 标签匹配(无需读全文),否则全文 `indexOf`:

```ts
async search(q, opts) {
  const limit = opts.limit ?? 50;
  const ql = q.toLowerCase();
  const hits: { path: string; snippet: string; score: number; mtime: number }[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    const mtime = f.stat?.mtime ?? 0;
    if (opts.type === "tag") {
      const cache = app.metadataCache.getFileCache(f);
      const tags = cache?.tags ? Object.keys(cache.tags).map((t) => t.replace(/^#/, "").toLowerCase()) : [];
      if (tags.some((t) => t.includes(ql))) {
        hits.push({ path: f.path, snippet: `#${q}`, score: 1, mtime });
      }
    } else {
      const content = await app.vault.read(f);
      const idx = content.toLowerCase().indexOf(ql);
      if (idx >= 0) {
        const start = Math.max(0, idx - 30);
        hits.push({ path: f.path, snippet: content.slice(start, idx + ql.length + 30), score: 1, mtime });
      }
    }
    if (hits.length >= limit) break;
  }
  return hits;
}
```

同步更新 `http-router.ts` 的 `VaultService.search` 返回类型(每个元素加 `mtime: number`),以及 `obsidian-client.ts` 的 `search` 返回类型元素加 `mtime: number`。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test tests/vault-service.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Checkpoint(不自动提交)**

Run: `npm run build:obsidian && npm run build:mcp && npm test`
Expected: 两端构建成功,全套 PASS。
变更文件:`vault-service.ts`、`http-router.ts`、`obsidian-client.ts`、`tests/vault-service.test.ts`、`dist/*`。
**不自动提交**,等待用户确认。

---

### Task 3: 409 needs_confirmation 错误可操作化

**Files:**
- Modify: `src/obsidian-app/http-router.ts` — `/notes` 写入 409 分支的 message
- Modify: `src/mcp/tools.ts` — `formatBridgeToolError` 增加 `needs_confirmation` 分支
- Test: `tests/http-router.test.ts`(扩展)、`tests/mcp-tools-pairing.test.ts`(扩展,若无工具错误测试则新建)

**Interfaces:**
- Consumes: `ERROR_CODES.needs_confirmation`(已有)
- Produces: 409 响应 message 含路径与重试方法;MCP 工具错误文本指引 AI "带 confirmed=true 重试"

- [ ] **Step 1: 写失败测试**

在 `tests/http-router.test.ts` 追加(验证 409 message 含路径):

```ts
test("POST /notes 到 people/ 的 409 message 含路径与重试指引", async () => {
  const token = freshToken();
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({
    method: "POST",
    path: "/notes",
    headers: { authorization: `Bearer ${token}` },
    body: { path: "people/zhang.md", content: "x" },
  });
  assert.equal(res.status, 409);
  const msg = (res.body as ApiErr).error.message;
  assert.match(msg, /people\/zhang\.md/);
  assert.match(msg, /confirmed/);
});
```

新建 `tests/mcp-tools-errors.test.ts`,直接测 `formatBridgeToolError`(Step 3 将其从 `tools.ts` 导出,故本步 import 失败 → TDD 真正的红灯):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBridgeToolError } from "../src/mcp/tools.ts";
import { BridgeError } from "../src/mcp/obsidian-client.ts";
import { ERROR_CODES } from "../src/shared/protocol.ts";

test("formatBridgeToolError 把 needs_confirmation 翻译为可操作指引", () => {
  const msg = formatBridgeToolError(
    new BridgeError(ERROR_CODES.needs_confirmation, "writing to people/x.md requires confirmation", 409),
  );
  assert.match(msg, /people\/x\.md/);
  assert.match(msg, /confirmed=true/);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test tests/http-router.test.ts`
Expected: 409 message 测试 FAIL(现 message 是 `writing to ${path} requires confirmation`,需含"confirmed"字样与明确重试语)。

- [ ] **Step 3: 实现**

(a) `http-router.ts` 409 分支增强 message:

```ts
if (level === "needs_confirmation" && req.headers[CONFIRMED_HEADER] !== "true") {
  return err(
    ERROR_CODES.needs_confirmation,
    `writing to ${path} requires confirmation; retry the same request with header X-Confirmed: true (or MCP param confirmed=true)`,
    409,
    { path, method: req.method },
  );
}
```

(b) `tools.ts` 导出并增强 `formatBridgeToolError`:

```ts
export function formatBridgeToolError(error: unknown): string {
  if (error instanceof BridgeError && error.code === ERROR_CODES.token_invalid) {
    return "Obsidian bridge is reachable but not paired. Ask the user for the pairing code shown in Obsidian, then call pair_with_code.";
  }
  if (error instanceof BridgeError && error.code === ERROR_CODES.bridge_unreachable) {
    return "Obsidian bridge is unreachable. Ask the user to open Obsidian and enable the Obsidian Bridge plugin.";
  }
  if (error instanceof BridgeError && error.code === ERROR_CODES.needs_confirmation) {
    return `${error.message}. To proceed, ask the user for approval, then retry upsert_note with confirmed=true.`;
  }
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test tests/http-router.test.ts && npx tsx --test tests/mcp-tools-errors.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Checkpoint(不自动提交)**

Run: `npm run build:obsidian && npm run build:mcp && npm test`
Expected: 全套 PASS。
变更文件:`http-router.ts`、`tools.ts`、`tests/http-router.test.ts`、`tests/mcp-tools-errors.test.ts`(新)、`dist/*`。
**不自动提交**,等待用户确认。

---

### Task 4: health 版本动态化 + 文档/常量对齐

**Files:**
- Modify: `src/obsidian-app/http-router.ts` — `appVersion` 来源
- Modify: `src/obsidian-app/main.ts` — 传入 manifest version
- Modify: `src/shared/protocol.ts` — `ENDPOINTS` 补登
- Modify: `protocol.md` — 补登端点表
- Test: `tests/http-router.test.ts`(扩展)

**Interfaces:**
- Consumes: `RouterDeps`(需新增 `appVersion` 字段)
- Produces: `/health` 返回真实插件版本;`ENDPOINTS` 与 `protocol.md` 含 `/notes?list`、`/diagnostics`、`/graph/*`(后者占位,P1+ 填充)

- [ ] **Step 1: 写失败测试**

`tests/http-router.test.ts` 追加:

```ts
test("/health 的 appVersion 来自注入而非写死", async () => {
  const r = createRouter({ ...base, vault: mockVault(), appVersion: "9.9.9" } as any);
  const res = await r({ method: "GET", path: "/health", headers: {}, body: "" });
  assert.equal((res.body as { appVersion: string }).appVersion, "9.9.9");
});
```

`tests/protocol.test.ts` 追加(验证 ENDPOINTS 含新键):

```ts
test("ENDPOINTS 登记了 list/diagnostics/graph 入口", () => {
  // ENDPOINTS 是字符串常量集合;graph 子路径在 router 用前缀匹配,此处只校验存在 graph 标记
  assert.ok(Object.values(ENDPOINTS).some((v) => String(v).includes("graph")));
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test tests/http-router.test.ts && npx tsx --test tests/protocol.test.ts`
Expected: FAIL(appVersion 仍为 "0.1.1";ENDPOINTS 无 graph)。

- [ ] **Step 3: 实现**

(a) `protocol.ts` 的 `ENDPOINTS` 增加 `graph`(子路径 `/graph/:op` 由 router 前缀匹配):

```ts
export const ENDPOINTS = {
  health: "/health",
  pair: "/pair",
  notes: "/notes",
  search: "/search",
  metadata: "/metadata",
  backlinks: "/backlinks",
  palace: "/palace",
  graph: "/graph", // 实际路径 /graph/:op
  events: "/events",
} as const;
```

(b) `http-router.ts`:`RouterDeps` 增加 `appVersion: string`;`/health` 用 `deps.appVersion`:

```ts
export interface RouterDeps {
  vault: VaultService;
  pairing: PairingStore;
  vaultName: string;
  appVersion: string;
  getRoomMarkdown: (room: string) => Promise<string>;
}
// /health 分支:
return { status: 200, body: { ok: true, protocol: PROTOCOL_VERSION, appVersion: deps.appVersion, vaultName: deps.vaultName } };
```

(c) `main.ts` `startServer` 调用传入版本(从插件 manifest):

```ts
this.server = startServer({
  port: DEFAULT_PORT,
  vault: createVaultService(this.app as unknown as Parameters<typeof createVaultService>[0]),
  pairing,
  vaultName: this.app.vault.getName(),
  appVersion: this.manifest.version,
  getRoomMarkdown: async (room) => { /* 不变 */ },
});
```

`server.ts` `startServer` 的 opts 与透传 `appVersion` 到 `createRouter` 一并补上(签名加 `appVersion: string`)。

(d) `protocol.md` 端点表补行:

```md
| GET | /notes?list= | 是 | 列出前缀下笔记路径 |
| GET | /diagnostics | 是 | 断链/孤儿/raw 未消化体检 |
| GET | /graph/neighbors | 是 | N 跳邻居(P1) |
| GET | /graph/path | 是 | 最短路径(P1) |
| GET | /graph/structure | 是 | hub/孤岛/桥(P2) |
| GET | /graph/similar | 是 | 相似推荐(P3) |
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test`
Expected: 全套 PASS(注意 `http-router.test.ts` 的 `base` 需补 `appVersion` 字段——在 Step 3 一并更新 `base`):

```ts
const base = {
  pairing: createPairingStore({ ttlMs: 600000, now: () => 1000, random: () => "112233" }),
  vaultName: "TestVault",
  appVersion: "0.0.0-test",
  getRoomMarkdown: async () => "## 触发场景\nx\n",
};
```

- [ ] **Step 5: Checkpoint(不自动提交)**

Run: `npm run build:obsidian && npm run build:mcp && npm test`
Expected: 全套 PASS。
变更文件:`protocol.ts`、`http-router.ts`、`server.ts`、`main.ts`、`protocol.md`、`tests/http-router.test.ts`、`tests/protocol.test.ts`、`dist/*`。
**P0 完成。不自动提交**,等待用户确认。

---

## Phase 1 — 邻居遍历 + 最短路径

### Task 5: graph-engine 纯函数模块(neighbors + shortestPath)

**Files:**
- Create: `src/obsidian-app/graph-engine.ts`
- Test: `tests/graph-engine.test.ts`(新)

**Interfaces:**
- Produces(供 Task 6+ 消费):
  - `export type Adjacency = Map<string, Set<string>>`
  - `export interface NeighborNode { path: string; depth: number; via: string }`
  - `export function neighbors(adj: Adjacency, start: string, depth: number): NeighborNode[]`
  - `export function shortestPath(adj: Adjacency, from: string, to: string): string[]`

- [ ] **Step 1: 写失败测试**

`tests/graph-engine.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { neighbors, shortestPath, type Adjacency } from "../src/obsidian-app/graph-engine.ts";

// 图: a-b-c-d(链), b-e(分支)
function chainGraph(): Adjacency {
  const m: Adjacency = new Map();
  const add = (x: string, y: string) => {
    if (!m.has(x)) m.set(x, new Set());
    if (!m.has(y)) m.set(y, new Set());
    m.get(x)!.add(y);
    m.get(y)!.add(x);
  };
  add("a", "b"); add("b", "c"); add("c", "d"); add("b", "e");
  // 孤立节点
  m.set("lonely", new Set());
  return m;
}

test("neighbors depth=1 返回直接邻居", () => {
  const ns = neighbors(chainGraph(), "b", 1).map((n) => n.path).sort();
  assert.deepEqual(ns, ["a", "c", "e"]);
});

test("neighbors depth=2 不重复、含 2 跳", () => {
  const ns = neighbors(chainGraph(), "a", 2).map((n) => n.path).sort();
  assert.deepEqual(ns, ["b", "c", "e"]); // a→b(1) →a,c,e(2,但 a 已见)
});

test("neighbors 起点不存在返回空", () => {
  assert.equal(neighbors(chainGraph(), "missing", 2).length, 0);
});

test("shortestPath 找到最短路径", () => {
  assert.deepEqual(shortestPath(chainGraph(), "a", "d"), ["a", "b", "c", "d"]);
});

test("shortestPath 起终点相同返回单元素", () => {
  assert.deepEqual(shortestPath(chainGraph(), "a", "a"), ["a"]);
});

test("shortestPath 不可达返回空数组", () => {
  assert.deepEqual(shortestPath(chainGraph(), "a", "lonely"), []);
});

test("shortestPath 节点不存在返回空", () => {
  assert.deepEqual(shortestPath(chainGraph(), "a", "ghost"), []);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test tests/graph-engine.test.ts`
Expected: FAIL(模块不存在,import 报错)。

- [ ] **Step 3: 实现 graph-engine.ts**

```ts
// 纯函数图算法模块,零 Obsidian 依赖。
// 输入:无向图邻接表(由 vault-service.buildAdjacencies 构建并按 direction 选取)。

export type Adjacency = Map<string, Set<string>>;

export interface NeighborNode {
  path: string;
  depth: number;
  via: string; // 上一跳;起点 via 为自身
}

// N 跳邻居(BFS,逐层扩展),不含起点本身。
export function neighbors(adj: Adjacency, start: string, depth: number): NeighborNode[] {
  const out: NeighborNode[] = [];
  if (!adj.has(start) || depth <= 0) return out;
  const seen = new Set<string>([start]);
  let frontier: NeighborNode[] = [{ path: start, depth: 0, via: start }];
  for (let d = 1; d <= depth; d++) {
    const next: NeighborNode[] = [];
    for (const node of frontier) {
      for (const n of adj.get(node.path) ?? new Set<string>()) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push({ path: n, depth: d, via: node.path });
      }
    }
    out.push(...next);
    frontier = next;
    if (next.length === 0) break;
  }
  return out;
}

// 最短路径(BFS)。不可达或节点不存在返回 []。
export function shortestPath(adj: Adjacency, from: string, to: string): string[] {
  if (!adj.has(from) || !adj.has(to)) return [];
  if (from === to) return [from];
  const prev = new Map<string, string>();
  const seen = new Set<string>([from]);
  const queue: string[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of adj.get(cur) ?? new Set<string>()) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      if (n === to) {
        const path = [to];
        let c: string = to;
        while (c !== from) {
          c = prev.get(c)!;
          path.unshift(c);
        }
        return path;
      }
      queue.push(n);
    }
  }
  return [];
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test tests/graph-engine.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Checkpoint(不自动提交)**

Run: `npm test`
Expected: 全套 PASS(新模块无构建产物影响,但属 obsidian-app,执行 `npm run build:obsidian`)。
变更文件:`src/obsidian-app/graph-engine.ts`、`tests/graph-engine.test.ts`、`dist/main.js`。
**不自动提交**,等待用户确认。

---

### Task 6: vault-service 适配层(buildAdjacencies + graphNeighbors/graphPath)

**Files:**
- Modify: `src/obsidian-app/vault-service.ts` — 新增 `buildAdjacencies`、`graphNeighbors`、`graphPath`
- Modify: `src/obsidian-app/http-router.ts` — `VaultService` 接口新增三方法
- Test: `tests/vault-service.test.ts`(扩展)

**Interfaces:**
- Consumes: `graph-engine.neighbors` / `shortestPath`(Task 5)、`ObsidianApp.metadataCache.resolvedLinks`
- Produces(供 Task 7 消费):
  - `VaultService.buildAdjacencies(): { fwd: Adjacency; back: Adjacency; both: Adjacency }`
  - `VaultService.graphNeighbors(path, depth, direction: "fwd"|"back"|"both"): { path: string; depth: number; via: string }[]`
  - `VaultService.graphPath(from, to): string[]`

- [ ] **Step 1: 写失败测试**

`tests/vault-service.test.ts` 追加:

```ts
test("buildAdjacencies 双向化 resolvedLinks 并保留孤立节点", () => {
  const app = mockApp(
    { "a.md": { content: "x" }, "b.md": { content: "[[a]]" }, "lonely.md": { content: "l" } },
    { resolvedLinks: { "b.md": { "a.md": 1 } } },
  );
  const s = createVaultService(app);
  const adj = s.buildAdjacencies();
  assert.ok(adj.both.has("lonely.md")); // 孤立节点也入表
  assert.equal(adj.both.get("a.md")!.size, 1); // a-b 双向后 a 连 b
  assert.ok(adj.fwd.get("b.md")!.has("a.md")); // 出边
  assert.ok(adj.back.get("a.md")!.has("b.md")); // 入边(反链)
});

test("graphNeighbors both 方向 N 跳", () => {
  const app = mockApp(
    { "a.md": {}, "b.md": {}, "c.md": {} },
    { resolvedLinks: { "a.md": { "b.md": 1 }, "b.md": { "c.md": 1 } } },
  );
  const s = createVaultService(app);
  const ns = s.graphNeighbors("a.md", 2, "both").map((n) => n.path).sort();
  assert.deepEqual(ns, ["b.md", "c.md"]);
});

test("graphPath 返回最短路径", () => {
  const app = mockApp(
    { "a.md": {}, "b.md": {}, "c.md": {} },
    { resolvedLinks: { "a.md": { "b.md": 1 }, "b.md": { "c.md": 1 } } },
  );
  const s = createVaultService(app);
  assert.deepEqual(s.graphPath("a.md", "c.md"), ["a.md", "b.md", "c.md"]);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test tests/vault-service.test.ts`
Expected: FAIL(三方法不存在)。

- [ ] **Step 3: 实现**

(a) `http-router.ts` 的 `VaultService` 接口新增:

```ts
buildAdjacencies(): { fwd: import("../obsidian-app/graph-engine.ts").Adjacency; back: import("../obsidian-app/graph-engine.ts").Adjacency; both: import("../obsidian-app/graph-engine.ts").Adjacency };
graphNeighbors(path: string, depth: number, direction: "fwd" | "back" | "both"): { path: string; depth: number; via: string }[];
graphPath(from: string, to: string): string[];
```

(b) `vault-service.ts` 顶部 import,并实现:

```ts
import { neighbors, shortestPath, type Adjacency } from "./graph-engine.ts";

// 在 createVaultService 返回对象中新增:
function buildAdjacencies() {
  const fwd: Adjacency = new Map();
  const back: Adjacency = new Map();
  const both: Adjacency = new Map();
  const ensure = (p: string) => {
    if (!fwd.has(p)) { fwd.set(p, new Set()); back.set(p, new Set()); both.set(p, new Set()); }
  };
  for (const f of app.vault.getMarkdownFiles()) ensure(f.path);
  for (const [src, links] of Object.entries(app.metadataCache.resolvedLinks)) {
    ensure(src);
    for (const tgt of Object.keys(links)) {
      ensure(tgt);
      fwd.get(src)!.add(tgt);
      back.get(tgt)!.add(src);
      both.get(src)!.add(tgt);
      both.get(tgt)!.add(src);
    }
  }
  return { fwd, back, both };
}

// 返回对象内:
buildAdjacencies,
async graphNeighbors(path, depth, direction) {
  const adj = buildAdjacencies();
  const map = direction === "fwd" ? adj.fwd : direction === "back" ? adj.back : adj.both;
  return neighbors(map, path, depth);
},
async graphPath(from, to) {
  return shortestPath(buildAdjacencies().both, from, to);
},
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test tests/vault-service.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Checkpoint(不自动提交)**

Run: `npm run build:obsidian && npm test`
Expected: 全套 PASS。
变更文件:`vault-service.ts`、`http-router.ts`、`tests/vault-service.test.ts`、`dist/main.js`。
**不自动提交**,等待用户确认。

---

### Task 7: P1 端到端链路(router + client + tools)

**Files:**
- Modify: `src/obsidian-app/http-router.ts` — `/graph/neighbors`、`/graph/path` 路由
- Modify: `src/mcp/obsidian-client.ts` — `graphNeighbors` / `graphPath` 方法
- Modify: `src/mcp/tools.ts` — `graph_neighbors` / `graph_path` 工具
- Test: `tests/http-router.test.ts`(扩展)、`tests/mcp.test.ts`(扩展)

**Interfaces:**
- Consumes: `VaultService.graphNeighbors` / `graphPath`(Task 6)
- Produces: HTTP `GET /graph/neighbors?path=&depth=&direction=`、`GET /graph/path?from=&to=`;MCP 工具 `graph_neighbors`、`graph_path`

- [ ] **Step 1: 写失败测试**

`tests/http-router.test.ts` 追加:

```ts
test("GET /graph/neighbors 返回 N 跳邻居", async () => {
  const token = freshToken();
  const r = createRouter({
    ...base, appVersion: "0", vault: mockVault({
      async graphNeighbors() { return [{ path: "b.md", depth: 1, via: "a.md" }]; },
    } as Partial<VaultService>),
  });
  const res = await r({
    method: "GET", path: "/graph/neighbors",
    headers: { authorization: `Bearer ${token}` }, body: "",
    query: { path: "a.md", depth: "1", direction: "both" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { nodes: { path: string }[] }).nodes[0].path, "b.md");
});

test("GET /graph/path 返回最短路径", async () => {
  const token = freshToken();
  const r = createRouter({
    ...base, appVersion: "0", vault: mockVault({
      async graphPath() { return ["a.md", "b.md", "c.md"]; },
    } as Partial<VaultService>),
  });
  const res = await r({
    method: "GET", path: "/graph/path",
    headers: { authorization: `Bearer ${token}` }, body: "",
    query: { from: "a.md", to: "c.md" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { path: string[] }).path, ["a.md", "b.md", "c.md"]);
});
```

`tests/mcp.test.ts` 追加 client 链路测试(模式同现有 read_note 测试):

```ts
test("graphNeighbors 链路:GET /graph/neighbors", async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ nodes: [{ path: "b.md", depth: 1, via: "a.md" }] }));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  const client = createObsidianClient({ baseUrl: `http://127.0.0.1:${port}`, getToken: async () => "T" });
  const r = await client.graphNeighbors("a.md", 1, "both");
  assert.equal(r[0].path, "b.md");
  await new Promise<void>((r) => srv.close(() => r()));
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test tests/http-router.test.ts && npx tsx --test tests/mcp.test.ts`
Expected: FAIL(路由/方法不存在)。

- [ ] **Step 3: 实现**

(a) `http-router.ts` 在 `/palace/:room` 分支后、`return 404` 前插入:

```ts
// /graph/neighbors
if (req.method === "GET" && req.path === "/graph/neighbors") {
  const q = req.query ?? {};
  const depth = Math.min(Math.max(Number(q.depth ?? 1) || 1, 1), 3); // clamp 1..3
  const direction = (q.direction === "fwd" || q.direction === "back" ? q.direction : "both") as "fwd" | "back" | "both";
  const nodes = await deps.vault.graphNeighbors(q.path ?? "", depth, direction);
  return { status: 200, body: { nodes } };
}
// /graph/path
if (req.method === "GET" && req.path === "/graph/path") {
  const q = req.query ?? {};
  const path = await deps.vault.graphPath(q.from ?? "", q.to ?? "");
  return { status: 200, body: { path, hops: Math.max(0, path.length - 1) } };
}
```

(b) `obsidian-client.ts` `ObsidianClient` 接口 + 实现新增:

```ts
// 接口:
graphNeighbors(path: string, depth: number, direction: "fwd" | "back" | "both"): Promise<{ path: string; depth: number; via: string }[]>;
graphPath(from: string, to: string): Promise<{ path: string[]; hops: number }>;
// 实现(返回对象内):
graphNeighbors: async (path, depth, direction) =>
  (await req("GET", "/graph/neighbors", { query: { path, depth: String(depth), direction } })).nodes,
graphPath: async (from, to) => req("GET", "/graph/path", { query: { from, to } }),
```

(c) `tools.ts` 在 `vault_diagnostics` 后注册:

```ts
server.tool(
  "graph_neighbors",
  "List notes within N hops (default 1, max 3) of a note, via wiki-link graph. direction: fwd (outgoing) | back (incoming) | both.",
  { path: z.string(), depth: z.number().optional(), direction: z.enum(["fwd", "back", "both"]).optional() },
  async ({ path, depth, direction }) => toolText(async () => {
    const nodes = await client.graphNeighbors(path, depth ?? 1, direction ?? "both");
    return JSON.stringify(nodes);
  }),
);

server.tool(
  "graph_path",
  "Find the shortest wiki-link path between two notes. Returns {path:[...], hops:n}; empty path if unreachable.",
  { from: z.string(), to: z.string() },
  async ({ from, to }) => toolText(async () => {
    const r = await client.graphPath(from, to);
    return JSON.stringify(r);
  }),
);
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test tests/http-router.test.ts && npx tsx --test tests/mcp.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Checkpoint(不自动提交)**

Run: `npm run build:obsidian && npm run build:mcp && npm test`
Expected: 全套 PASS。
变更文件:`http-router.ts`、`obsidian-client.ts`、`tools.ts`、`tests/http-router.test.ts`、`tests/mcp.test.ts`、`dist/*`。
**P1 完成。不自动提交**,等待用户确认。

---

## Phase 2 — 结构分析

### Task 8: graph-engine structure(hub / 孤岛 / 桥边)

**Files:**
- Modify: `src/obsidian-app/graph-engine.ts` — 新增 `structure`
- Test: `tests/graph-engine.test.ts`(扩展)

**Interfaces:**
- Produces:
  - `export interface StructureReport { hubs: string[]; orphans: string[]; bridges: { from: string; to: string }[] }`
  - `export function structure(adj: Adjacency, top?: number): StructureReport`

- [ ] **Step 1: 写失败测试**

`tests/graph-engine.test.ts` 追加:

```ts
import { structure } from "../src/obsidian-app/graph-engine.ts";

test("structure 识别 hub / orphans / bridges", () => {
  // a-b, b-c, c-d, 孤立 lonely;桥为 c-d(删后 d 断开)
  const g: Adjacency = new Map();
  const add = (x: string, y: string) => {
    if (!g.has(x)) g.set(x, new Set());
    if (!g.has(y)) g.set(y, new Set());
    g.get(x)!.add(y); g.get(y)!.add(x);
  };
  add("a", "b"); add("b", "c"); add("c", "d");
  g.set("lonely", new Set());
  const rep = structure(g, 10);
  // b、c 度数最高(各 2),排在前
  assert.ok(rep.hubs.includes("b"));
  assert.ok(rep.hubs.includes("c"));
  assert.ok(rep.orphans.includes("lonely"));
  // c-d 是桥
  assert.ok(rep.bridges.some((br) => (br.from === "c" && br.to === "d") || (br.from === "d" && br.to === "c")));
});

test("structure top 限制 hub 数量", () => {
  const g: Adjacency = new Map();
  const add = (x: string, y: string) => { if (!g.has(x)) g.set(x, new Set()); if (!g.has(y)) g.set(y, new Set()); g.get(x)!.add(y); g.get(y)!.add(x); };
  add("hub", "x1"); add("hub", "x2"); add("hub", "x3");
  const rep = structure(g, 1);
  assert.equal(rep.hubs.length, 1);
  assert.equal(rep.hubs[0], "hub");
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test tests/graph-engine.test.ts`
Expected: FAIL(`structure` 未导出)。

- [ ] **Step 3: 实现 structure**

`graph-engine.ts` 追加:

```ts
export interface StructureReport {
  hubs: string[];
  orphans: string[];
  bridges: { from: string; to: string }[];
}

export function structure(adj: Adjacency, top = 10): StructureReport {
  // hub: 度数 top-N(降序)
  const hubs = [...adj.entries()]
    .filter(([, ns]) => ns.size > 0)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, top)
    .map(([n]) => n);
  // orphans: 零度
  const orphans = [...adj.entries()].filter(([, ns]) => ns.size === 0).map(([n]) => n);
  // bridges: Tarjan 桥边算法(递归)
  const bridges = findBridges(adj);
  return { hubs, orphans, bridges };
}

function findBridges(adj: Adjacency): { from: string; to: string }[] {
  const result: { from: string; to: string }[] = [];
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const visited = new Set<string>();
  let time = 0;

  function dfs(u: string, parent: string | null) {
    visited.add(u);
    disc.set(u, time);
    low.set(u, time);
    time++;
    for (const v of adj.get(u) ?? new Set<string>()) {
      if (!visited.has(v)) {
        dfs(v, u);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (low.get(v)! > disc.get(u)!) {
          result.push(u < v ? { from: u, to: v } : { from: v, to: u });
        }
      } else if (v !== parent) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
  }

  for (const node of adj.keys()) {
    if (!visited.has(node)) dfs(node, null);
  }
  return result;
}
```

> 注:`findBridges` 用递归,图谱直径通常 <10,栈深度安全;超大 vault 若出现"删后连通分量数增加"性能问题,按 spec 第 6 节降级为近似判定。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test tests/graph-engine.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Checkpoint(不自动提交)**

Run: `npm run build:obsidian && npm test`
Expected: 全套 PASS。
变更文件:`graph-engine.ts`、`tests/graph-engine.test.ts`、`dist/main.js`。
**不自动提交**,等待用户确认。

---

### Task 9: P2 端到端链路(graph_structure)

**Files:**
- Modify: `src/obsidian-app/vault-service.ts` — `graphStructure`
- Modify: `src/obsidian-app/http-router.ts` — `VaultService` 接口 + `/graph/structure` 路由
- Modify: `src/mcp/obsidian-client.ts` — `graphStructure` 方法
- Modify: `src/mcp/tools.ts` — `graph_structure` 工具
- Test: `tests/http-router.test.ts`、`tests/mcp.test.ts`(扩展)

**Interfaces:**
- Consumes: `graph-engine.structure`(Task 8)、`buildAdjacencies`(Task 6)
- Produces: `VaultService.graphStructure(top?): StructureReport`;HTTP `GET /graph/structure?top=`;MCP `graph_structure`

- [ ] **Step 1: 写失败测试**

`tests/http-router.test.ts` 追加:

```ts
test("GET /graph/structure 返回 hub/孤岛/桥", async () => {
  const token = freshToken();
  const r = createRouter({
    ...base, appVersion: "0", vault: mockVault({
      async graphStructure() { return { hubs: ["b.md"], orphans: ["l.md"], bridges: [{ from: "c.md", to: "d.md" }] }; },
    } as Partial<VaultService>),
  });
  const res = await r({ method: "GET", path: "/graph/structure", headers: { authorization: `Bearer ${token}` }, body: "" });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as any).hubs, ["b.md"]);
  assert.deepEqual((res.body as any).bridges, [{ from: "c.md", to: "d.md" }]);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test tests/http-router.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

(a) `http-router.ts` `VaultService` 接口新增:

```ts
graphStructure(top?: number): Promise<{ hubs: string[]; orphans: string[]; bridges: { from: string; to: string }[] }>;
```

(b) `vault-service.ts` import `structure` 并新增:

```ts
import { neighbors, shortestPath, structure } from "./graph-engine.ts";
// 返回对象内:
async graphStructure(top) {
  return structure(buildAdjacencies().both, top);
},
```

(c) `http-router.ts` 路由(`/graph/path` 后):

```ts
if (req.method === "GET" && req.path === "/graph/structure") {
  const q = req.query ?? {};
  const top = q.top ? Math.min(Math.max(Number(q.top) || 10, 1), 100) : 10;
  return { status: 200, body: await deps.vault.graphStructure(top) };
}
```

(d) `obsidian-client.ts` 接口 + 实现:

```ts
graphStructure(top?: number): Promise<{ hubs: string[]; orphans: string[]; bridges: { from: string; to: string }[] }>;
// 实现:
graphStructure: (top) => req("GET", "/graph/structure", top ? { query: { top: String(top) } } : {}),
```

(e) `tools.ts` 注册:

```ts
server.tool(
  "graph_structure",
  "Vault graph structure: hub notes (most connections), orphans (no links), bridges (edges whose removal splits the graph).",
  { top: z.number().optional() },
  async ({ top }) => toolText(async () => JSON.stringify(await client.graphStructure(top))),
);
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test tests/http-router.test.ts && npx tsx --test tests/mcp.test.ts`
Expected: PASS。

- [ ] **Step 5: Checkpoint(不自动提交)**

Run: `npm run build:obsidian && npm run build:mcp && npm test`
Expected: 全套 PASS。
变更文件:`vault-service.ts`、`http-router.ts`、`obsidian-client.ts`、`tools.ts`、`tests/http-router.test.ts`、`dist/*`。
**P2 完成。不自动提交**,等待用户确认。

---

## Phase 3 — 相似推荐 + 关系类型化

### Task 10: graph-engine similar(Jaccard 共邻居)

**Files:**
- Modify: `src/obsidian-app/graph-engine.ts` — 新增 `similar`
- Test: `tests/graph-engine.test.ts`(扩展)

**Interfaces:**
- Produces:
  - `export interface SimilarNode { path: string; score: number }`
  - `export function similar(adj: Adjacency, start: string, limit?: number): SimilarNode[]`

> **对 spec 的有意简化(YAGNI):** spec 4.2 签名为 `similar(adj, tagMap, path, limit)`(含共标签加权)。本轮只实现**共邻居 Jaccard**(spec 第 6 节风险表亦据此),`tagMap` 参数省略;共标签作为后续可选项。

- [ ] **Step 1: 写失败测试**

`tests/graph-engine.test.ts` 追加:

```ts
import { similar } from "../src/obsidian-app/graph-engine.ts";

test("similar 按共邻居 Jaccard 排序", () => {
  // x 与 y 都连到 shared1/shared2 → 高相似;x 与 z 只共 1 个
  const g: Adjacency = new Map();
  const add = (x: string, y: string) => { if (!g.has(x)) g.set(x, new Set()); if (!g.has(y)) g.set(y, new Set()); g.get(x)!.add(y); g.get(y)!.add(x); };
  add("x", "shared1"); add("x", "shared2"); add("x", "z");
  add("y", "shared1"); add("y", "shared2");
  const sim = similar(g, "x", 10);
  const y = sim.find((s) => s.path === "y")!;
  const z = sim.find((s) => s.path === "z")!;
  assert.ok(y.score > z.score);
  assert.ok(y.score > 0 && y.score <= 1);
});

test("similar 起点不存在返回空", () => {
  assert.equal(similar(new Map(), "missing").length, 0);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test tests/graph-engine.test.ts`
Expected: FAIL(`similar` 未导出)。

- [ ] **Step 3: 实现**

`graph-engine.ts` 追加:

```ts
export interface SimilarNode {
  path: string;
  score: number; // 0..1 Jaccard
}

// 共邻居 Jaccard 相似度:|N(x)∩N(y)| / |N(x)∪N(y)|,不含 x/y 自身。
export function similar(adj: Adjacency, start: string, limit = 10): SimilarNode[] {
  if (!adj.has(start)) return [];
  const startN = adj.get(start) ?? new Set<string>();
  const out: SimilarNode[] = [];
  for (const [node, neighbors] of adj) {
    if (node === start) continue;
    let inter = 0;
    for (const n of startN) if (neighbors.has(n)) inter++;
    const union = startN.size + neighbors.size - inter;
    const score = union === 0 ? 0 : inter / union;
    if (score > 0) out.push({ path: node, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test tests/graph-engine.test.ts`
Expected: PASS。

- [ ] **Step 5: Checkpoint(不自动提交)**

Run: `npm run build:obsidian && npm test`
Expected: 全套 PASS。
变更文件:`graph-engine.ts`、`tests/graph-engine.test.ts`、`dist/main.js`。
**不自动提交**,等待用户确认。

---

### Task 11: buildAdjacencies 合并 frontmatter.links + graphSimilar

**Files:**
- Modify: `src/obsidian-app/vault-service.ts` — `buildAdjacencies` 合并 frontmatter.links、新增 `graphSimilar`
- Modify: `src/obsidian-app/http-router.ts` — `VaultService` 接口新增 `graphSimilar`
- Test: `tests/vault-service.test.ts`(扩展)

**Interfaces:**
- Consumes: `graph-engine.similar`(Task 10)、`metadataCache.getFileCache().frontmatter.links`
- Produces: `VaultService.graphSimilar(path, limit?): { path: string; score: number }[]`;`buildAdjacencies` 现合并 `frontmatter.links: [{to}]` 类型化边

- [ ] **Step 1: 写失败测试**

`tests/vault-service.test.ts` 追加:

```ts
test("buildAdjacencies 合并 frontmatter.links 类型化边", () => {
  const app = mockApp(
    { "p.md": { content: "x", frontmatter: { links: [{ to: "people/z.md", type: "owner" }] } }, "people/z.md": { content: "z" } },
  );
  const s = createVaultService(app);
  const adj = s.buildAdjacencies();
  assert.ok(adj.fwd.get("p.md")!.has("people/z.md")); // frontmatter.links 进入出边
  assert.ok(adj.both.get("people/z.md")!.has("p.md")); // 双向
});

test("graphSimilar 按共邻居返回相似笔记", () => {
  const app = mockApp(
    { "x.md": { content: "[[s1]]" }, "y.md": { content: "[[s1]]" }, "s1.md": { content: "" } },
    { resolvedLinks: { "x.md": { "s1.md": 1 }, "y.md": { "s1.md": 1 } } },
  );
  const s = createVaultService(app);
  const sim = s.graphSimilar("x.md", 10);
  assert.ok(sim.some((n) => n.path === "y.md"));
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test tests/vault-service.test.ts`
Expected: FAIL(`graphSimilar` 不存在;frontmatter.links 未纳入)。

- [ ] **Step 3: 实现**

(a) `vault-service.ts` import `similar`,扩展 `buildAdjacencies` 合并 frontmatter.links:

```ts
import { neighbors, shortestPath, structure, similar, type Adjacency } from "./graph-engine.ts";

// buildAdjacencies 内,resolvedLinks 处理后追加 frontmatter.links:
function buildAdjacencies() {
  const fwd: Adjacency = new Map();
  const back: Adjacency = new Map();
  const both: Adjacency = new Map();
  const ensure = (p: string) => {
    if (!fwd.has(p)) { fwd.set(p, new Set()); back.set(p, new Set()); both.set(p, new Set()); }
  };
  for (const f of app.vault.getMarkdownFiles()) ensure(f.path);
  for (const [src, links] of Object.entries(app.metadataCache.resolvedLinks)) {
    ensure(src);
    for (const tgt of Object.keys(links)) {
      ensure(tgt);
      fwd.get(src)!.add(tgt); back.get(tgt)!.add(src);
      both.get(src)!.add(tgt); both.get(tgt)!.add(src);
    }
  }
  // 合并 frontmatter.links(类型化关系边)
  for (const f of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(f);
    const fl = (cache?.frontmatter?.links as Array<{ to?: string }> | undefined) ?? [];
    for (const edge of fl) {
      const to = edge?.to;
      if (!to) continue;
      ensure(f.path); ensure(to);
      fwd.get(f.path)!.add(to);
      both.get(f.path)!.add(to); both.get(to)!.add(f.path);
    }
  }
  return { fwd, back, both };
}
```

(b) 新增 `graphSimilar`(返回对象内):

```ts
async graphSimilar(path, limit) {
  return similar(buildAdjacencies().both, path, limit);
},
```

(c) `http-router.ts` `VaultService` 接口新增 `graphSimilar(path: string, limit?: number): Promise<{ path: string; score: number }[]>`。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test tests/vault-service.test.ts`
Expected: PASS。

- [ ] **Step 5: Checkpoint(不自动提交)**

Run: `npm run build:obsidian && npm test`
Expected: 全套 PASS。
变更文件:`vault-service.ts`、`http-router.ts`、`tests/vault-service.test.ts`、`dist/main.js`。
**不自动提交**,等待用户确认。

---

### Task 12: P3 端到端(graph_similar + link_notes)

**Files:**
- Modify: `src/obsidian-app/http-router.ts` — `/graph/similar` 路由
- Modify: `src/mcp/obsidian-client.ts` — `graphSimilar` 方法
- Modify: `src/mcp/tools.ts` — `graph_similar`、`link_notes` 工具
- Test: `tests/http-router.test.ts`、`tests/mcp.test.ts`(扩展)

**Interfaces:**
- Consumes: `VaultService.graphSimilar`(Task 11)、`client.readNote` + `upsertNote`(已有,供 `link_notes` 用)
- Produces: HTTP `GET /graph/similar?path=&limit=`;MCP 工具 `graph_similar`、`link_notes(from, to, type?)`

- [ ] **Step 1: 写失败测试**

`tests/http-router.test.ts` 追加:

```ts
test("GET /graph/similar 返回相似笔记", async () => {
  const token = freshToken();
  const r = createRouter({
    ...base, appVersion: "0", vault: mockVault({
      async graphSimilar() { return [{ path: "y.md", score: 0.5 }]; },
    } as Partial<VaultService>),
  });
  const res = await r({ method: "GET", path: "/graph/similar", headers: { authorization: `Bearer ${token}` }, body: "", query: { path: "x.md", limit: "5" } });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { similar: { path: string; score: number }[] }).similar[0].path, "y.md");
});
```

`tests/mcp.test.ts` 追加 `graphSimilar` client 链路测试(模式同 graphNeighbors,断言 `similar` 数组)。

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test tests/http-router.test.ts && npx tsx --test tests/mcp.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

(a) `http-router.ts` 路由(`/graph/structure` 后):

```ts
if (req.method === "GET" && req.path === "/graph/similar") {
  const q = req.query ?? {};
  const limit = q.limit ? Math.min(Math.max(Number(q.limit) || 10, 1), 50) : 10;
  const similarNodes = await deps.vault.graphSimilar(q.path ?? "", limit);
  return { status: 200, body: { similar: similarNodes } };
}
```

(b) `obsidian-client.ts` 接口 + 实现:

```ts
graphSimilar(path: string, limit?: number): Promise<{ path: string; score: number }[]>;
// 实现:
graphSimilar: async (path, limit) => (await req("GET", "/graph/similar", { query: { path, ...(limit ? { limit: String(limit) } : {}) } })).similar,
```

(c) `tools.ts` 注册两个工具:

```ts
server.tool(
  "graph_similar",
  "Find notes similar to a given one by shared neighbors (Jaccard over the wiki-link graph). Returns [{path, score}].",
  { path: z.string(), limit: z.number().optional() },
  async ({ path, limit }) => toolText(async () => JSON.stringify(await client.graphSimilar(path, limit))),
);

server.tool(
  "link_notes",
  "Create a link from one note to another. If type is omitted, appends a [[to]] wiki link to the body; if type is given, records a typed edge in the from-note's frontmatter links:[{to,type}]. Writing to protected zones (people/, projects/, wiki/, ...) requires confirmed=true.",
  { from: z.string(), to: z.string(), type: z.string().optional(), confirmed: z.boolean().optional() },
  async ({ from, to, type, confirmed }) => toolText(async () => {
    if (type) {
      // 类型化:读 from → 合并 frontmatter.links → upsert(带 confirmed)
      const r = await client.readNote(from);
      const updated = mergeFrontmatterLink(r.content, { to, type });
      await client.upsertNote(from, updated, { confirmed });
      return `typed link: ${from} -[${type}]-> ${to}`;
    }
    // 无类型:append wiki link
    const r = await client.readNote(from);
    const sep = r.content.endsWith("\n") ? "" : "\n";
    await client.upsertNote(from, `${r.content}${sep}\n[[${to.replace(/\.md$/, "")}]]\n`, { confirmed });
    return `wiki link: ${from} -> ${to}`;
  }),
);
```

(d) `tools.ts` 顶部新增纯函数 `mergeFrontmatterLink`(保守合并,不破坏已有 frontmatter):

```ts
// 在 from 笔记正文里合并一条 frontmatter.links 边。极简健壮实现:
// - 有 frontmatter 则在 links 数组追加(去重 by to);
// - 无 frontmatter 则前插一个。
function mergeFrontmatterLink(body: string, edge: { to: string; type: string }): string {
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) {
    return `---\nlinks:\n  - to: ${edge.to}\n    type: ${edge.type}\n---\n${body}`;
  }
  const fm = fmMatch[1];
  // 已有 links: 则追加(简单文本注入)
  if (/^links:/m.test(fm)) {
    const inserted = fm.replace(/^(links:\n(?:[ \t]+.*\n?)*)/m, `$1  - to: ${edge.to}\n    type: ${edge.type}\n`);
    return body.replace(fmMatch[0], `---\n${inserted}\n---\n`);
  }
  const newFm = `links:\n  - to: ${edge.to}\n    type: ${edge.type}\n` + fm;
  return body.replace(fmMatch[0], `---\n${newFm}\n---\n`);
}
```

> 注:`link_notes` 复用 `upsert_note`,因此写受保护区时同样走 409 + `confirmed=true`(Task 3 的可操作错误信息会指引 AI)。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test tests/http-router.test.ts && npx tsx --test tests/mcp.test.ts && npm test`
Expected: 全套 PASS。

- [ ] **Step 5: Checkpoint(不自动提交)**

Run: `npm run build:obsidian && npm run build:mcp && npm test`
Expected: 全套 PASS。
变更文件:`http-router.ts`、`obsidian-client.ts`、`tools.ts`、`tests/http-router.test.ts`、`tests/mcp.test.ts`、`dist/*`。
**P3 完成。不自动提交**,等待用户确认。

---

## 收尾(全部 Phase 完成后)

- [ ] 更新 `plugins/obsidian-bridge/README.md`「能力」一节,补列 `graph_neighbors` / `graph_path` / `graph_structure` / `graph_similar` / `link_notes`,以及 P0 修复点。
- [ ] 更新 `.lume-plugin/marketplace.json` 与 `plugins/obsidian-bridge/lume-plugin.json` 的 `version`(按语义化版本,P0+图谱建议 `0.2.0`)——**经用户确认后**再改版本号与发布。
- [ ] 全量回归:`npm test` 全绿;`npm run build:obsidian && npm run build:mcp` 双产物新鲜。
- [ ] 在真实 Obsidian 中冒烟:`bridge_status` → `list_notes memory/inbox/` → `graph_neighbors`/`graph_path`,确认 HTTP 桥与图谱查询端到端可用。
