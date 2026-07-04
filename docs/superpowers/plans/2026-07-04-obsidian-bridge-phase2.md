# obsidian-bridge Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全 obsidian-bridge 的消化闭环——四个消化技能(review-inbox / apply-memory / update-profile / vault-doctor)+ 它们依赖的 `list_notes` 列目录与 `diagnostics`(断链/孤儿/raw 未消化)能力,跑通完整的「消化—沉淀—生长」流水线。

**Architecture:** 延续 Phase 1 双端 HTTP 桥接。Obsidian 端新增 `listNotes` + `diagnostics`(接 `metadataCache.resolvedLinks`/`unresolvedLinks`),并把 `backlinks` 从占位 `[]` 真实化;Lume 端新增 `list_notes`/`vault_diagnostics` tool + 四个编排技能 SKILL.md + 四张 palace 房间卡。协议仍 v1,新端点向后兼容。

**Tech Stack:** TypeScript 5 / Node ≥20 / `node:http`(Obsidian 端)/ `@modelcontextprotocol/sdk` 1.29(Lume 端)/ esbuild / `node:test` + tsx。

## Global Constraints

- 延续 `2026-07-03-obsidian-bridge-phase1.md` 的 Global Constraints(Node ≥20/ESM/协议 v1/`127.0.0.1:43112`/Bearer + `X-Protocol-Version`/`network.outbound: 127.0.0.1:43112`/tsx 测试/中文注释/**不碰 git**)。
- **Node 24 strip-only 兼容**:禁用 TS parameter property(`constructor(public x)`),一律显式字段赋值(见 phase1 修正记录 #3)。
- **向后兼容**:不改动 Phase 1 已有端点/tool 的签名与行为,只新增端点/tool/方法。
- 房间卡五段格式与 `digest_note_room` 一致:`## 触发场景` / `## 必读(按顺序)` / `## 条件读` / `## 输出位置` / `## 坑 / 禁区`。
- 仓库门禁:`npm --prefix plugins/obsidian-bridge test` 全绿;`npm run check:index` in sync;根 `npm test` 不因 obsidian-bridge 失败。

## File Structure(Phase 2 增量)

```
plugins/obsidian-bridge/
├── src/
│   ├── obsidian-app/
│   │   ├── vault-service.ts     # Modify:+listNotes / backlinks 真实化 / +diagnostics;ObsidianApp 接口 +resolvedLinks/unresolvedLinks
│   │   ├── http-router.ts       # Modify:VaultService 接口 +listNotes/+diagnostics;GET /notes?list= 、GET /diagnostics
│   │   └── boot.ts              # Modify:导出 PALACE_ROOMS 数组,ensurePalaceRooms 循环装 5 张卡
│   └── mcp/
│       ├── obsidian-client.ts   # Modify:+listNotes / +diagnostics
│       └── tools.ts             # Modify:+list_notes / +vault_diagnostics tool
├── skills/
│   ├── review-inbox/SKILL.md    # Create
│   ├── apply-memory/SKILL.md    # Create
│   ├── update-profile/SKILL.md  # Create
│   └── vault-doctor/SKILL.md    # Create
└── tests/
    ├── vault-service.test.ts    # Modify:+listNotes / +backlinks 真实 / +diagnostics
    ├── http-router.test.ts      # Modify:+/notes?list= 、+/diagnostics
    └── palace-rooms.test.ts     # Create:遍历 PALACE_ROOMS 解析五段
```

依赖方向不变(见 phase1):纯函数 → 服务 → 装配。T1/T2 自底向上(接口 → router → client → tool),T3 房间卡,T4–T7 技能,T8 集成。

---

### Task 1: list_notes 端到端(列目录)

**Files:**
- Modify: `plugins/obsidian-bridge/src/obsidian-app/vault-service.ts`(VaultService 实现 +`listNotes`)
- Modify: `plugins/obsidian-bridge/src/obsidian-app/http-router.ts`(VaultService 接口 +`listNotes`;GET /notes?list=)
- Modify: `plugins/obsidian-bridge/src/mcp/obsidian-client.ts`(+`listNotes`)
- Modify: `plugins/obsidian-bridge/src/mcp/tools.ts`(+`list_notes` tool)
- Modify: `plugins/obsidian-bridge/tests/vault-service.test.ts`
- Modify: `plugins/obsidian-bridge/tests/http-router.test.ts`

**Interfaces:**
- Consumes: Phase 1 的 `VaultService`、`createRouter`、`ObsidianClient`、`registerTools`。
- Produces: `VaultService.listNotes(prefix: string): Promise<string[]>`;`ObsidianClient.listNotes(prefix)`;端点 `GET /notes?list=<prefix>` → `{ paths: string[] }`;MCP tool `list_notes { prefix }`。

- [ ] **Step 1: vault-service 加 listNotes(写失败测试)**

在 `tests/vault-service.test.ts` 末尾追加:
```ts
test("listNotes filters by prefix", async () => {
  const app = mockApp({
    "memory/inbox/a.md": { content: "x" },
    "memory/inbox/b.md": { content: "y" },
    "people/z.md": { content: "z" },
  });
  const s = createVaultService(app);
  const paths = await (s as any).listNotes("memory/inbox/");
  assert.deepEqual(paths.sort(), ["memory/inbox/a.md", "memory/inbox/b.md"]);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm --prefix plugins/obsidian-bridge test 2>&1 | grep -E "listNotes|fail " | head
```
Expected: FAIL(`listNotes is not a function` / 类型缺失)。

- [ ] **Step 3: 实现 vault-service.listNotes + 扩 VaultService 接口**

`http-router.ts` 的 `VaultService` 接口,在 `backlinks(...)` 行后加:
```ts
  listNotes(prefix: string): Promise<string[]>;
```

`vault-service.ts` 的 `createVaultService` 返回对象,在 `backlinks` 之后追加:
```ts
    async listNotes(prefix) {
      return app.vault
        .getMarkdownFiles()
        .filter((f) => f.path.startsWith(prefix))
        .map((f) => f.path);
    },
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm --prefix plugins/obsidian-bridge test 2>&1 | grep -E "listNotes|pass |fail " | head
```
Expected: listNotes PASS。

- [ ] **Step 5: router 加 GET /notes?list=(写失败测试)**

在 `tests/http-router.test.ts` 末尾追加:
```ts
test("GET /notes?list= 返回路径列表", async () => {
  const token = freshToken();
  const r = createRouter({
    ...base,
    vault: mockVault({ async listNotes(p: string) { return ["memory/inbox/a.md"]; } }),
  });
  const res = await r({
    method: "GET",
    path: "/notes",
    headers: { authorization: `Bearer ${token}` },
    body: "",
    query: { list: "memory/inbox/" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { paths: string[] }).paths, ["memory/inbox/a.md"]);
});
```

- [ ] **Step 6: 跑确认失败**

```bash
npm --prefix plugins/obsidian-bridge test 2>&1 | grep -E "list=|fail " | head
```
Expected: FAIL(paths undefined)。

- [ ] **Step 7: router 实现 list 分支**

`http-router.ts` 的 GET `/notes` 分支,在 `if (req.method === "GET") {` 之后、`if (!(await deps.vault.exists(q.path)))` 之前插入:
```ts
      if (q.list !== undefined) {
        return { status: 200, body: { paths: await deps.vault.listNotes(q.list) } };
      }
```

- [ ] **Step 8: 跑确认通过**

```bash
npm --prefix plugins/obsidian-bridge test 2>&1 | grep -E "pass |fail " | head
```
Expected: PASS。

- [ ] **Step 9: client + tool 接线**

`obsidian-client.ts` 的 `ObsidianClient` 接口加:
```ts
  listNotes(prefix: string): Promise<string[]>;
```
返回对象在 `readPalace` 后加:
```ts
    listNotes: async (prefix) => (await req("GET", "/notes", { query: { list: prefix } })).paths,
```

`tools.ts` 的 `registerTools` 末尾(`read_palace` tool 之后)追加:
```ts
  server.tool(
    "list_notes",
    "List note paths under a vault prefix (e.g. 'memory/inbox/')",
    { prefix: z.string() },
    async ({ prefix }) => {
      const paths = await client.listNotes(prefix);
      return { content: [{ type: "text" as const, text: JSON.stringify(paths) }] };
    },
  );
```

- [ ] **Step 10: 完成门**——`npm --prefix plugins/obsidian-bridge test` 全绿。

---

### Task 2: backlinks 真实化 + /diagnostics 端点 + vault_diagnostics tool

**Files:**
- Modify: `vault-service.ts`(ObsidianApp 接口 +resolvedLinks/unresolvedLinks;backlinks 真实化;+diagnostics)
- Modify: `http-router.ts`(VaultService 接口 +diagnostics;GET /diagnostics)
- Modify: `obsidian-client.ts`(+diagnostics)
- Modify: `tools.ts`(+vault_diagnostics tool)
- Modify: `tests/vault-service.test.ts`、`tests/http-router.test.ts`

**Interfaces:**
- Consumes: Phase 1 `VaultService`、T1 `listNotes`。
- Produces:`backlinks(path)` 真实返回(基于 resolvedLinks);`VaultService.diagnostics(): Promise<{ brokenLinks: { from: string; link: string }[]; orphans: string[]; rawUndigested: string[] }>`;`ObsidianClient.diagnostics()`;端点 `GET /diagnostics`;MCP tool `vault_diagnostics`。

- [ ] **Step 1: 扩 mockApp 支持 resolvedLinks/unresolvedLinks,写 backlinks + diagnostics 失败测试**

在 `tests/vault-service.test.ts` 的 `mockApp` 返回对象里,`metadataCache` 中追加两个只读字段(由参数注入):
```ts
function mockApp(
  files: Record<string, { content: string; tags?: string[]; frontmatter?: Record<string, unknown> }>,
  opts: { resolvedLinks?: Record<string, Record<string, number>>; unresolvedLinks?: Record<string, string[]> } = {},
) {
  // ...原有 store 构造不变...
  return {
    vault: { /* 原有 */ },
    metadataCache: {
      getFileCache: (f: { path: string }) => ({ /* 原有 */ }),
      resolvedLinks: opts.resolvedLinks ?? {},
      unresolvedLinks: opts.unresolvedLinks ?? {},
    },
  } as any;
}
```
在文件末尾追加测试:
```ts
test("backlinks 从 resolvedLinks 反查", async () => {
  const app = mockApp(
    { "a.md": { content: "x" }, "b.md": { content: "[[a]]" } },
    { resolvedLinks: { "b.md": { "a.md": 2 } } },
  );
  const s = createVaultService(app);
  const bl = await s.backlinks("a.md");
  assert.equal(bl.length, 1);
  assert.equal(bl[0].fromPath, "b.md");
  assert.equal(bl[0].occurrences, 2);
});

test("diagnostics 汇总断链/孤儿/raw 未消化", async () => {
  const app = mockApp(
    { "raw/x.pdf.md": { content: "x" }, "note.md": { content: "[[bad]]" }, "lonely.md": { content: "l" } },
    {
      resolvedLinks: { "note.md": {} },
      unresolvedLinks: { "note.md": ["bad"] },
    },
  );
  const s = createVaultService(app);
  const d = await (s as any).diagnostics();
  assert.deepEqual(d.brokenLinks, [{ from: "note.md", link: "bad" }]);
  assert.ok(d.orphans.includes("lonely.md"));
  assert.ok(d.rawUndigested.includes("raw/x.pdf.md"));
});
```

- [ ] **Step 2: 跑确认失败**

```bash
npm --prefix plugins/obsidian-bridge test 2>&1 | grep -E "backlinks 从|diagnostics 汇总|fail " | head
```
Expected: FAIL(backlinks 返回 [];diagnostics undefined)。

- [ ] **Step 3: 扩 ObsidianApp 接口 + 实现 backlinks 真实化 + diagnostics**

`vault-service.ts` 的 `ObsidianApp.metadataCache` 类型,在 `getFileCache` 后加:
```ts
    resolvedLinks: Record<string, Record<string, number>>;
    unresolvedLinks: Record<string, string[]>;
```

把 `backlinks` 的占位实现替换为:
```ts
    async backlinks(path) {
      const target = path.replace(/\.md$/, "");
      const out: { fromPath: string; occurrences: number }[] = [];
      for (const [src, links] of Object.entries(app.metadataCache.resolvedLinks)) {
        for (const [tgt, count] of Object.entries(links)) {
          if (tgt === path || tgt.replace(/\.md$/, "") === target) {
            out.push({ fromPath: src, occurrences: count });
          }
        }
      }
      return out;
    },
```
在 `backlinks` 之后追加 `diagnostics`:
```ts
    async diagnostics() {
      const brokenLinks: { from: string; link: string }[] = [];
      for (const [src, links] of Object.entries(app.metadataCache.unresolvedLinks)) {
        for (const link of links) brokenLinks.push({ from: src, link });
      }
      const allFiles = app.vault.getMarkdownFiles().map((f) => f.path);
      const connected = new Set<string>();
      for (const [src, links] of Object.entries(app.metadataCache.resolvedLinks)) {
        if (Object.keys(links).length > 0) connected.add(src);
        for (const tgt of Object.keys(links)) connected.add(tgt);
      }
      const orphans = allFiles.filter((p) => !connected.has(p));
      const rawUndigested = allFiles.filter((p) => p.startsWith("raw/"));
      return { brokenLinks, orphans, rawUndigested };
    },
```

- [ ] **Step 4: 跑确认通过**

```bash
npm --prefix plugins/obsidian-bridge test 2>&1 | grep -E "pass |fail " | head
```
Expected: PASS。

- [ ] **Step 5: router 加 GET /diagnostics(写失败测试)**

`tests/http-router.test.ts` 末尾追加:
```ts
test("GET /diagnostics 返回体检数据", async () => {
  const token = freshToken();
  const r = createRouter({
    ...base,
    vault: mockVault({
      async diagnostics() {
        return { brokenLinks: [{ from: "n.md", link: "bad" }], orphans: ["l.md"], rawUndigested: [] };
      },
    } as any),
  });
  const res = await r({ method: "GET", path: "/diagnostics", headers: { authorization: `Bearer ${token}` }, body: "" });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as any).brokenLinks, [{ from: "n.md", link: "bad" }]);
});
```

- [ ] **Step 6: 跑确认失败 → 实现 → 通过**

在 `http-router.ts` 的 `VaultService` 接口加:
```ts
  diagnostics(): Promise<{ brokenLinks: { from: string; link: string }[]; orphans: string[]; rawUndigested: string[] }>;
```
在路由里(`/backlinks` 分支之后)加:
```ts
    if (req.method === "GET" && req.path === "/diagnostics") {
      return { status: 200, body: await deps.vault.diagnostics() };
    }
```
`obsidian-client.ts` 接口加 `diagnostics(): Promise<{ brokenLinks: { from: string; link: string }[]; orphans: string[]; rawUndigested: string[] }>;`,返回对象加:
```ts
    diagnostics: () => req("GET", "/diagnostics"),
```
`tools.ts` 在 `list_notes` 后追加:
```ts
  server.tool(
    "vault_diagnostics",
    "Vault health: broken links, orphans (no links), and raw/ files not yet digested",
    {},
    async () => {
      const d = await client.diagnostics();
      return { content: [{ type: "text" as const, text: JSON.stringify(d) }] };
    },
  );
```
Run: `npm --prefix plugins/obsidian-bridge test 2>&1 | grep -E "pass |fail " | head`
Expected: PASS。

- [ ] **Step 7: 完成门**——全量测试通过。

---

### Task 3: 四张 palace 房间卡(boot.ts 重构 + 解析测试)

**Files:**
- Modify: `plugins/obsidian-bridge/src/obsidian-app/boot.ts`(导出 `PALACE_ROOMS`,循环装入)
- Create: `plugins/obsidian-bridge/tests/palace-rooms.test.ts`

**Interfaces:**
- Consumes: Phase 1 `parseRoomCard`(palace.ts)。
- Produces:`export const PALACE_ROOMS: { path: string; md: string }[]`(含 digest + 4 张新卡);`ensurePalaceRooms` 循环创建全部。

- [ ] **Step 1: 写失败测试**

`tests/palace-rooms.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PALACE_ROOMS } from "../src/obsidian-app/boot.ts";
import { parseRoomCard } from "../src/obsidian-app/palace.ts";

test("PALACE_ROOMS 含 5 张卡且每张可解析五段", () => {
  const ids = PALACE_ROOMS.map((r) => r.path).sort();
  assert.deepEqual(ids, [
    "palace/apply_memory_room.md",
    "palace/digest_note_room.md",
    "palace/review_inbox_room.md",
    "palace/update_profile_room.md",
    "palace/vault_doctor_room.md",
  ]);
  for (const room of PALACE_ROOMS) {
    const card = parseRoomCard(room.md);
    assert.ok(card.trigger.length > 0, `${room.path} 缺触发场景`);
    assert.ok(card.outputLocation.length > 0, `${room.path} 缺输出位置`);
  }
});
```

- [ ] **Step 2: 跑确认失败**

```bash
npm --prefix plugins/obsidian-bridge test 2>&1 | grep -E "PALACE_ROOMS|fail " | head
```
Expected: FAIL(PALACE_ROOMS 未导出)。

- [ ] **Step 3: 重构 boot.ts**

把 `boot.ts` 整体替换为(保留 digest 房间卡 + 新增 4 张):
```ts
export const DEFAULT_PORT = 43112;

const DIGEST_ROOM_MD = `# digest_note_room

## 触发场景
用户请求消化一篇笔记(或选区)时进入此房间。

## 必读(按顺序)
- profile.md
- vault.md
- style.md
- <当前待消化笔记>

## 条件读
- 涉及人:people/<谁>.md
- 涉及项目:projects/<什么>.md

## 输出位置
memory/inbox/<YYYY-MM-DD>.md

## 坑 / 禁区
- 不要直接写 people/ 或 projects/(需走确认门)
- inbox 文件可自由写,不弹确认
`;

const REVIEW_INBOX_ROOM_MD = `# review_inbox_room

## 触发场景
用户请求审核 memory/inbox/ 待沉淀条目时进入此房间。

## 必读(按顺序)
- vault.md
- memory_policy.md
- 用 list_notes 列出 memory/inbox/ 全部文件

## 条件读
- 条目涉及人:people/<谁>.md(若存在)
- 条目涉及项目:projects/<什么>.md(若存在)

## 输出位置
向用户输出「可确认清单」(不写文件):每条含来源、建议去向(people/projects/wiki/丢弃)、置信度。

## 坑 / 禁区
- 只读 inbox,不修改 inbox 文件
- 不要在此阶段写长期记忆(交给 apply-memory)
`;

const APPLY_MEMORY_ROOM_MD = `# apply_memory_room

## 触发场景
用户确认 review-inbox 的清单后,把条目沉淀到长期记忆时进入此房间。

## 必读(按顺序)
- profile.md
- vault.md
- 用户确认的清单

## 条件读
- 目标人物:people/<谁>.md(若已存在,需合并而非覆盖)
- 目标项目:projects/<什么>.md(同上)

## 输出位置
people/ 、projects/ 、wiki/ 下对应文件(长期记忆区)。

## 坑 / 禁区
- 长期记忆区写入必须带 confirmed=true(走确认门)
- 已存在文件优先 PATCH 追加,避免覆盖历史
`;

const UPDATE_PROFILE_ROOM_MD = `# update_profile_room

## 触发场景
用户请求从 memory/feedback/ 反馈中学习、更新画像时进入此房间。

## 必读(按顺序)
- profile.md
- style.md
- 用 list_notes 列出 memory/feedback/ 全部文件并逐条读取

## 条件读
- 无

## 输出位置
profile.md 、style.md(根级画像文件)。

## 坑 / 禁区
- 写入必须带 confirmed=true
- 只提炼稳定模式,忽略偶发反馈;每次更新逐条让用户确认
`;

const VAULT_DOCTOR_ROOM_MD = `# vault_doctor_room

## 触发场景
用户请求给 Vault 做体检时进入此房间。

## 必读(按顺序)
- vault.md
- 调用 vault_diagnostics 取断链/孤儿/raw 未消化

## 条件读
- 用 list_notes 列 raw/ 核对未消化清单
- 用 list_notes 列 memory/inbox/ 核对积压

## 输出位置
向用户输出体检报告(不写文件):分类列出问题 + 每类的下一步建议技能。

## 坑 / 禁区
- 只读不写
- 报告里引用具体路径,便于用户定位
`;

export const PALACE_ROOMS: { path: string; md: string }[] = [
  { path: "palace/digest_note_room.md", md: DIGEST_ROOM_MD },
  { path: "palace/review_inbox_room.md", md: REVIEW_INBOX_ROOM_MD },
  { path: "palace/apply_memory_room.md", md: APPLY_MEMORY_ROOM_MD },
  { path: "palace/update_profile_room.md", md: UPDATE_PROFILE_ROOM_MD },
  { path: "palace/vault_doctor_room.md", md: VAULT_DOCTOR_ROOM_MD },
];

export async function ensurePalaceRooms(app: import("obsidian").App): Promise<void> {
  for (const room of PALACE_ROOMS) {
    if (app.vault.getAbstractFileByPath(room.path)) continue;
    try {
      await app.vault.create(room.path, room.md);
    } catch {
      /* 已存在并发创建 */
    }
  }
}
```

- [ ] **Step 4: 跑确认通过**

```bash
npm --prefix plugins/obsidian-bridge test 2>&1 | grep -E "PALACE_ROOMS|pass |fail " | head
```
Expected: PASS(5 张卡解析成功)。

- [ ] **Step 5: 完成门**——palace-rooms 测试通过,Phase 1 既有测试不回归。

---

### Task 4: review-inbox 技能

**Files:**
- Create: `plugins/obsidian-bridge/skills/review-inbox/SKILL.md`

**Interfaces:**
- Consumes: T1 `list_notes`、Phase 1 `read_note`/`read_palace`。
- Produces:可被 Lume 触发的 review-inbox 技能。

- [ ] **Step 1: 写 SKILL.md**

```markdown
---
name: review-inbox
description: 扫描 memory/inbox/ 全部待沉淀条目,归纳去重,产出一份可确认清单(每条标来源/建议去向/置信度)。使用 read_palace 房间卡决定流程。
---

# review-inbox

把 inbox 里积压的候选记忆整理成一份人审清单。

## 执行步骤(严格按序)

1. **取房间卡**:调用 `read_palace { room: "review_inbox_room" }`。
2. **列 inbox**:调用 `list_notes { prefix: "memory/inbox/" }`,逐个 `read_note` 读取全部条目。
3. **按 mustRead 读上下文**:读 `vault.md`、`memory_policy.md`(理解沉淀规则)。
4. **归纳去重**:跨文件合并重复/相关条目;为每条判定:
   - **建议去向**:people / projects / wiki / 丢弃
   - **置信度**:高 / 中 / 低(依据来源笔记可靠性 + 是否与其他条目互证)
   - **来源**:inbox 文件路径
5. **输出清单**(直接呈现给用户,不写文件):

每行格式:
\`\`\`
- [<去向>] <要点> | 置信度: <高/中/低> | 来源: <path>
\`\`\`

## 坑 / 禁区

- **只读** inbox,不修改任何文件。
- 不要在此阶段写长期记忆(那是 apply-memory 的事,需用户确认)。
- 不确定去向的条目标「低置信度」并保留,不要擅自丢弃。
```

- [ ] **Step 2: 完成门**——文件存在;`npm --prefix plugins/obsidian-bridge test` 不回归。

---

### Task 5: apply-memory 技能

**Files:**
- Create: `plugins/obsidian-bridge/skills/apply-memory/SKILL.md`

**Interfaces:**
- Consumes: T1 `list_notes`、Phase 1 `read_note`/`upsert_note`(confirmed)/`read_palace`。
- Produces:apply-memory 技能(清单 → 长期记忆,走确认门)。

- [ ] **Step 1: 写 SKILL.md**

```markdown
---
name: apply-memory
description: 把用户已确认的 review-inbox 清单沉淀到长期记忆区(people/projects/wiki)。写入走确认门(先出计划,用户逐条确认)。使用 read_palace 房间卡决定流程。
---

# apply-memory

把确认过的清单条目合并进长期记忆。

## 执行步骤(严格按序)

1. **取房间卡**:调用 `read_palace { room: "apply_memory_room" }`。
2. **按 mustRead 读上下文**:`profile.md`、`vault.md`、用户确认的清单。
3. **合并计划**(先计划后执行):对每条清单条目,先读目标文件(若存在):
   - 已存在 → 计划 PATCH 追加(不覆盖历史)
   - 不存在 → 计划新建
4. **出合并计划呈现给用户**:列出「将新建 X / 将追加 Y / 各加什么内容」,**等用户逐条确认**。
5. **执行写入**(每条用户确认后):
   - 长期记忆区(people/ projects/ wiki/)写入**必须**带 `confirmed: true`(`upsert_note` 的确认门)
   - 已存在文件用追加方式(先读全文 → 拼接 → 写回),保留原内容

## 坑 / 禁区

- **绝不**未确认就写长期记忆区——必须 `confirmed: true`。
- 已存在文件**优先追加**,避免抹掉用户手写的历史。
- 不动 raw/、不动 inbox/(inbox 清理由用户后续手动或单独技能)。
```

- [ ] **Step 2: 完成门**——文件存在;测试不回归。

---

### Task 6: update-profile 技能

**Files:**
- Create: `plugins/obsidian-bridge/skills/update-profile/SKILL.md`

**Interfaces:**
- Consumes:T1 `list_notes`、Phase 1 `read_note`/`upsert_note`(confirmed)/`read_palace`。
- Produces:update-profile 技能(feedback → profile/style,走确认门)。

- [ ] **Step 1: 写 SKILL.md**

```markdown
---
name: update-profile
description: 从 memory/feedback/ 的 👍/👎 反馈中提炼稳定模式,产出对 profile.md / style.md 的更新建议,逐条经用户确认后写入。使用 read_palace 房间卡决定流程。
---

# update-profile

让 Agent 从反馈中学习,更新画像(越用越懂你)。

## 执行步骤(严格按序)

1. **取房间卡**:调用 `read_palace { room: "update_profile_room" }`。
2. **按 mustRead 读上下文**:当前 `profile.md`、`style.md`。
3. **读全部反馈**:`list_notes { prefix: "memory/feedback/" }`,逐个 `read_note`。
4. **提炼稳定模式**:只在**多条反馈反复出现**时才视为稳定模式;偶发反馈忽略。例如「用户对市场推断要保持克制」。
5. **出更新建议呈现给用户**:对 profile.md / style.md 各列「将加 / 将改哪条」,**逐条确认**。
6. **执行写入**(确认后):根级画像文件写入**必须**带 `confirmed: true`。

## 坑 / 禁区

- **绝不**未确认就改 profile.md / style.md。
- 只采纳**稳定模式**(反复出现),单次反馈不构成画像更新。
- 画像文件优先追加而非重写。
```

- [ ] **Step 2: 完成门**——文件存在;测试不回归。

---

### Task 7: vault-doctor 技能

**Files:**
- Create: `plugins/obsidian-bridge/skills/vault-doctor/SKILL.md`

**Interfaces:**
- Consumes:T2 `vault_diagnostics`、T1 `list_notes`、Phase 1 `read_palace`。
- Produces:vault-doctor 技能(全 Vault 体检报告)。

- [ ] **Step 1: 写 SKILL.md**

```markdown
---
name: vault-doctor
description: 给整个 Vault 做体检:断链、孤儿笔记、raw/ 未消化、inbox 积压,分类产出报告并给出每类问题的下一步建议技能。只读不写。使用 read_palace 房间卡决定流程。
---

# vault-doctor

Vault 体检,定位"死数据"与结构问题。

## 执行步骤(严格按序)

1. **取房间卡**:调用 `read_palace { room: "vault_doctor_room" }`。
2. **取诊断数据**:调用 `vault_diagnostics { }`,获得 `{ brokenLinks, orphans, rawUndigested }`。
3. **补充核对**:
   - `list_notes { prefix: "raw/" }` 与 `rawUndigested` 交叉核对
   - `list_notes { prefix: "memory/inbox/" }` 统计 inbox 积压数量
4. **产出体检报告**(呈现给用户,不写文件),分类列出:

\`\`\`
## 断链(N 处)
- <from.md> → <坏链接>
## 孤儿笔记(N 篇,无任何链接)
- <path>
## raw/ 未消化(N 个)
- <path>  → 建议:digest-note
## inbox 积压(N 条)
→ 建议:review-inbox → apply-memory
\`\`\`

5. **下一步建议**:每类问题指明对应技能(digest-note / review-inbox / apply-memory)。

## 坑 / 禁区

- **只读不写**。
- 报告引用**具体路径**,便于用户定位。
- 不擅自修复(修复由用户触发对应技能)。
```

- [ ] **Step 2: 完成门**——文件存在;测试不回归。

---

### Task 8: 集成验证(重建产物 + 全量门禁)

**Files:**
- 无新增;重建 `dist/main.js` / `dist/mcp.js`。

**Interfaces:**
- Consumes:T1–T7 全部。

- [ ] **Step 1: 重建两端产物**

```bash
npm --prefix plugins/obsidian-bridge run build:obsidian 2>&1 | tail -4
npm --prefix plugins/obsidian-bridge run build:mcp 2>&1 | tail -4
```
Expected:两个 `⚡ Done`,`dist/main.js` 与 `dist/mcp.js` 更新。

- [ ] **Step 2: 插件全量测试**

```bash
npm --prefix plugins/obsidian-bridge test 2>&1 | grep -E "tests |pass |fail " | head
```
Expected:`pass` 等于 Phase 1 的 28 + T1(2)+ T2(3)+ T3(1)= 34(±新断言),`fail 0`。

- [ ] **Step 3: 仓库门禁**

```bash
npm run build:index && npm run check:index 2>&1 | tail -3
npm test 2>&1 | grep -E "pass [0-9]+|fail [0-9]+" | tail
```
Expected:`check:index` → in sync;根 `npm test` 的 obsidian-bridge 部分全过(剩余失败仅 lume-chrome 预存)。

- [ ] **Step 4: 完成门(Phase 2 验收)**

- 插件测试全绿;`dist/main.js` / `dist/mcp.js` 重建。
- 新端点 `GET /notes?list=`、`GET /diagnostics` 可用;新 tool `list_notes`、`vault_diagnostics` 注册。
- 四张新房间卡可解析;四个技能 SKILL.md 就位。
- 完整「消化—沉淀—生长」流水线编排就绪(digest-note → review-inbox → apply-memory / update-profile / vault-doctor)。

Phase 2 完成。运行时冒烟仍需在 Lume + Obsidian 内人工验证。

---

## Self-Review

**1. Spec 覆盖(对照设计文档 §11/§16)**:
- `review-inbox` → T4;`apply-memory` → T5;`update-profile` → T6;`vault-doctor` → T7(§11 全覆盖)。
- vault-doctor 依赖的断链/孤儿数据 → T2 `diagnostics`(§16)。
- review-inbox/vault-doctor 依赖的列目录 → T1 `list_notes`(§16)。
- 每技能配房间卡 → T3(§16 "每个技能配 palace 房间卡")。
- backlinks 真实化(Phase 1 占位)→ T2。

**2. 占位符扫描**:无 TBD/TODO;所有代码步骤含完整代码块;SKILL.md 含完整编排步骤。

**3. 类型一致性**:
- `VaultService.listNotes(prefix): Promise<string[]>` 在 T1 接口/实现/测试一致。
- `diagnostics()` 返回 `{ brokenLinks: { from, link }[]; orphans: string[]; rawUndigested: string[] }` 在 T2 vault-service/router/client/tool/test 一致。
- `PALACE_ROOMS: { path, md }[]` 在 T3 导出/测试一致;5 张卡 path 与测试断言一致。
- `list_notes`/`vault_diagnostics` tool 名在 T1/T2 与 SKILL(T4/T7)引用一致。

无修复项。
