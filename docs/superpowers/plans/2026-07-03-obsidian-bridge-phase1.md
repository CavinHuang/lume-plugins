# obsidian-bridge Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 obsidian-bridge 的 Phase 1——最小可演示「消化」闭环:Obsidian 端桥接插件 + Lume 端 MCP server + digest-note 技能,能从 Lume 消化一篇笔记写入 `memory/inbox/`。

**Architecture:** 双端通过版本化本地 HTTP 协议解耦(方案 A)。Obsidian 端(Node `http` server 跑在 Obsidian 插件内)暴露 REST + SSE;Lume 端(MCP server,独立 Node 进程)把 tool 调用翻译成 HTTP。安全靠三层信任分层(按路径分级)+ 配对码/token 鉴权 + localhost 绑定。

**Tech Stack:** TypeScript 5 / Node ≥20 / `node:http`(Obsidian 端)/ `@modelcontextprotocol/sdk`(Lume 端 MCP)/ esbuild(打包)/ `node:test` + tsx(测试)/ Obsidian Plugin API。

## Global Constraints

- Node `>=20`(仓库 `package.json` engines);ESM(`"type":"module"`)。
- 插件目录 `plugins/obsidian-bridge/`;`lume-plugin.json` 的 `name` 必须等于目录名,匹配 `^[a-z0-9_-]{1,64}$`。
- 协议版本号固定为 `1`,请求头 `X-Protocol-Version: 1`;Obsidian 端独立 `manifest.json` 有自己的 `version`(与 Lume 清单解耦)。
- Obsidian 端 HTTP server 绑定 `127.0.0.1`(不监听外部网卡);默认端口 `43112`(可在插件设置改)。
- 鉴权:除 `/health` 与 `/pair` 外,所有端点要 `Authorization: Bearer <token>`;需确认区写入要额外 `X-Confirmed: true` 才执行。
- Lume 端仅声明 `network`(连 127.0.0.1);不声明 `filesystem`/`shell`。
- 测试:被测代码用 TypeScript,测试文件 `*.test.ts`,在插件目录用 `tsx --test` 运行。
- **Git**:遵循用户工作习惯,本 plan 不含自动 `git commit` 步骤;每 task 以「测试通过」为完成门,提交由用户主动触发。
- 仓库门禁:根目录 `npm test && npm run check:index` 须保持通过(`build:index` 会把新插件登记进 `.lume-plugin/marketplace.json`)。
- 代码注释语言:中文(与现有仓库一致,见 `plugins/lume-chrome/`)。

## File Structure

```
plugins/obsidian-bridge/
├── lume-plugin.json                 # T1 Lume 清单(mcpServers + permissions.network)
├── package.json                     # T1 插件自身脚本/依赖(test/build)
├── README.md                        # T1 双端说明 + 「## 权限说明」
├── protocol.md                      # T1 协议契约文档(人读)
├── tsconfig.json                    # T1 TS 配置
├── esbuild.config.mjs               # T9 打包配置(Obsidian main.js + Lume mcp)
├── src/
│   ├── shared/protocol.ts           # T2 两端共享:端点/错误码/类型(单一事实源)
│   ├── obsidian-app/
│   │   ├── trust-policy.ts          # T3 纯函数:路径 → 信任级
│   │   ├── palace.ts                # T4 纯函数:房间卡五段解析
│   │   ├── pairing-store.ts         # T5 纯逻辑:配对码/token
│   │   ├── http-router.ts           # T6 纯函数:路由 + 协议 + 错误 + 鉴权 + 确认门
│   │   ├── vault-service.ts         # T8 依赖 Obsidian API:CRUD/搜索/元数据/反链
│   │   ├── server.ts                # T9 Node http 装配
│   │   ├── main.ts                  # T9 Plugin 生命周期
│   │   ├── palace-rooms/
│   │   │   └── digest_note_room.md  # T11 房间卡资源(装入 vault)
│   │   └── manifest.json            # T9 Obsidian 插件清单(独立 version)
│   └── mcp/
│       ├── obsidian-client.ts       # T7 纯网络层:HTTP 封装 + token + 错误映射
│       ├── tools.ts                 # T10 tool 定义聚合
│       └── server.ts                # T10 MCP server 装配
├── skills/
│   └── digest-note/SKILL.md         # T11 消化技能编排
└── tests/
    ├── protocol.test.ts             # T2
    ├── trust-policy.test.ts         # T3
    ├── palace.test.ts               # T4
    ├── pairing-store.test.ts        # T5
    ├── http-router.test.ts          # T6
    ├── obsidian-client.test.ts      # T7
    ├── vault-service.test.ts        # T8
    ├── mcp.test.ts                  # T10
    └── smoke-digest.test.ts         # T12 跨端冒烟
```

**依赖方向**:`shared/protocol` ← 所有人;`obsidian-app/*`(除 vault-service)为纯函数,先于装配实现;`mcp/obsidian-client` 依赖 `shared/protocol`;`vault-service` 与 `obsidian-client` 互不依赖(分属两端)。TDD 自底向上:纯函数 → 服务 → 装配 → 冒烟。

---

### Task 1: 插件骨架与 Lume 市场清单

**Files:**
- Create: `plugins/obsidian-bridge/lume-plugin.json`
- Create: `plugins/obsidian-bridge/package.json`
- Create: `plugins/obsidian-bridge/tsconfig.json`
- Create: `plugins/obsidian-bridge/README.md`
- Create: `plugins/obsidian-bridge/protocol.md`
- Create: `plugins/obsidian-bridge/.gitkeep`(仅占位 src/ skills/ tests/)

**Interfaces:**
- Consumes: 仓库根 `scripts/build-index.mjs`(扫描 `plugins/*/lume-plugin.json`)
- Produces: 目录 `plugins/obsidian-bridge/` 存在,被索引识别;`npm run check:index` 通过。

- [ ] **Step 1: 创建 `lume-plugin.json`**

```json
{
  "schema": "lume-plugin/v1",
  "name": "obsidian-bridge",
  "version": "0.1.0",
  "description": "把 Obsidian Vault 变成第二大脑消化系统:信任分层 + Memory Palace + 消化技能,通过本地 HTTP 桥接暴露给 Lume",
  "author": "CavinHuang",
  "displayName": "Obsidian Bridge",
  "category": "Knowledge",
  "skills": ["./skills/"],
  "mcpServers": "./mcp.json",
  "permissions": {
    "network": { "hosts": ["127.0.0.1"] }
  },
  "lume": { "hooksOnly": false }
}
```

> `mcp.json` 在 T10 创建;此处先声明路径。`permissions.network` 的确切字段 schema 须与 `scripts/lib/manifest-rules.mjs` 镜像的 Lume 校验逻辑一致——若 `check:index` 报错,按报错调整为仓库支持的形状(如 `{ allow: ["127.0.0.1"] }`)。

- [ ] **Step 2: 创建 `package.json`**

```json
{
  "name": "obsidian-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "tsx --test \"tests/**/*.test.ts\"",
    "build:obsidian": "node esbuild.config.mjs --target=obsidian",
    "build:mcp": "node esbuild.config.mjs --target=mcp"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "esbuild": "^0.24.0",
    "@types/node": "^22.0.0",
    "obsidian": "^1.4.16"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 3: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: 创建 `README.md`(含「## 权限说明」)**

```markdown
# Obsidian Bridge

把 Obsidian Vault 变成「第二大脑消化系统」。Lume 通过本地 HTTP 桥接读写/搜索/消化 Vault,按三层信任分层安全沉淀长期记忆。

## 能力(Phase 1)

- **MCP server**:`read_note` / `search` / `upsert_note` / `delete_note` / `get_metadata` / `backlinks` / `read_palace`。
- **信任分层**:`raw/` 只读;`memory/inbox/` 自由写;`people/` 等长期记忆区写入需确认。
- **Memory Palace**:`digest-note` 技能按 `palace/digest_note_room.md` 房间卡编排。
- **digest-note 技能**:消化笔记 → `memory/inbox/<date>.md`。

## 权限说明

| 权限 | 用途 |
|---|---|
| `network: 127.0.0.1` | 仅连接本地 Obsidian 端桥接插件(127.0.0.1:43112),不联网外发 |

本插件**不**请求 `shell` 或 `filesystem`。所有 Vault 操作经本地 HTTP 桥接完成。

## 安装

### 1. Obsidian 端(配套桥接插件)
- 从仓库 Release 下载 `main.js` / `manifest.json`。
- 放入 `<Vault>/.obsidian/plugins/obsidian-bridge/`,在 Obsidian 设置→社区插件启用。
- 启用后在插件设置页查看「配对码」。

### 2. Lume 端
- 在 Lume 市场安装 `obsidian-bridge`,首次使用输入 Obsidian 显示的配对码完成绑定。
```

- [ ] **Step 5: 创建 `protocol.md`(人读契约骨架)**

```markdown
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
| GET | /events | 是 | SSE 事件流 |

## 错误码
`bridge_unreachable` / `token_invalid` / `vault_mismatch` / `protocol_mismatch` / `raw_readonly` / `needs_confirmation` / `not_found` / `merge_conflict`
```

- [ ] **Step 6: 占位目录 + 重新生成索引并校验**

```bash
mkdir -p plugins/obsidian-bridge/src plugins/obsidian-bridge/skills plugins/obsidian-bridge/tests
# 占位,确保 src 等目录入 git
node -e "require('fs').writeFileSync('plugins/obsidian-bridge/src/.gitkeep','')"
node -e "require('fs').writeFileSync('plugins/obsidian-bridge/skills/.gitkeep','')"
node -e "require('fs').writeFileSync('plugins/obsidian-bridge/tests/.gitkeep','')"
npm run build:index
npm run check:index
```

Expected: `.lume-plugin/marketplace.json` 的 `plugins[]` 含 `obsidian-bridge`;`check:index` 退出码 0。

- [ ] **Step 7: 完成门**

根目录 `npm test` 保持通过(新插件暂无根级测试,不影响)。Task 1 完成。

---

### Task 2: 共享协议类型 + 契约测试

**Files:**
- Create: `plugins/obsidian-bridge/src/shared/protocol.ts`
- Create: `plugins/obsidian-bridge/tests/protocol.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `ENDPOINTS`、`ERROR_CODES`、`PROTOCOL_VERSION`、类型 `TrustLevel`、`RoomCard`、`ApiError`、`NoteRef`、`SearchHit`、`Backlink`——后续所有 task 引用。

- [ ] **Step 1: 写失败测试**

`tests/protocol.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL_VERSION, ERROR_CODES, ENDPOINTS,
  type TrustLevel, type RoomCard,
} from "../src/shared/protocol.ts";

test("PROTOCOL_VERSION is 1", () => {
  assert.equal(PROTOCOL_VERSION, 1);
});

test("ERROR_CODES covers contract", () => {
  for (const code of [
    "bridge_unreachable", "token_invalid", "vault_mismatch",
    "protocol_mismatch", "raw_readonly", "needs_confirmation",
    "not_found", "merge_conflict",
  ] as const) {
    assert.equal(ERROR_CODES[code], code);
  }
});

test("ENDPOINTS has health/pair/notes/search/metadata/backlinks/palace/events", () => {
  assert.ok(ENDPOINTS.health && ENDPOINTS.pair && ENDPOINTS.notes);
  assert.ok(ENDPOINTS.search && ENDPOINTS.metadata && ENDPOINTS.backlinks);
  assert.ok(ENDPOINTS.palace && ENDPOINTS.events);
});

test("TrustLevel union", () => {
  const levels: TrustLevel[] = ["raw_readonly", "free_write", "needs_confirmation", "free"];
  assert.equal(levels.length, 4);
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd plugins/obsidian-bridge && npm test -- tests/protocol.test.ts
```
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 `src/shared/protocol.ts`**

```ts
// 两端共享的协议契约。单一事实源——改这里,两端都变。
export const PROTOCOL_VERSION = 1 as const;

export const ERROR_CODES = {
  bridge_unreachable: "bridge_unreachable",
  token_invalid: "token_invalid",
  vault_mismatch: "vault_mismatch",
  protocol_mismatch: "protocol_mismatch",
  raw_readonly: "raw_readonly",
  needs_confirmation: "needs_confirmation",
  not_found: "not_found",
  merge_conflict: "merge_conflict",
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

export const ENDPOINTS = {
  health: "/health",
  pair: "/pair",
  notes: "/notes",
  search: "/search",
  metadata: "/metadata",
  backlinks: "/backlinks",
  palace: "/palace", // 实际路径 /palace/:room
  events: "/events",
} as const;

export type TrustLevel = "raw_readonly" | "free_write" | "needs_confirmation" | "free";

// 房间卡五段(Memory Palace)
export interface RoomCard {
  trigger: string;
  mustRead: string[];        // 按顺序
  conditionalRead: string[];
  outputLocation: string;
  pitfalls: string[];
}

// 通用错误体
export interface ApiError {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export interface NoteRef { path: string; }

export interface SearchHit {
  path: string;
  snippet: string;
  score: number;
}

export interface Backlink {
  fromPath: string;
  occurrences: number;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd plugins/obsidian-bridge && npm test -- tests/protocol.test.ts
```
Expected: PASS(4 tests)。

- [ ] **Step 5: 完成门**——全部 protocol 测试通过。

---

### Task 3: trust-policy(纯函数:路径 → 信任级)

**Files:**
- Create: `plugins/obsidian-bridge/src/obsidian-app/trust-policy.ts`
- Create: `plugins/obsidian-bridge/tests/trust-policy.test.ts`

**Interfaces:**
- Consumes: `TrustLevel`(from `../shared/protocol.ts`)
- Produces: `classifyTrust(path: string): TrustLevel`、`CONFIRMED_HEADER`、`NEEDS_CONFIRMATION_PATHS`——T6 http-router 用来拦截写入。

- [ ] **Step 1: 写失败测试**

`tests/trust-policy.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTrust } from "../src/obsidian-app/trust-policy.ts";

test("raw/ is raw_readonly at any depth", () => {
  assert.equal(classifyTrust("raw/x.pdf"), "raw_readonly");
  assert.equal(classifyTrust("raw/sub/a.png"), "raw_readonly");
});

test("sources/ and memory inbox/feedback are free_write", () => {
  assert.equal(classifyTrust("sources/note.md"), "free_write");
  assert.equal(classifyTrust("memory/inbox/2026-07-03.md"), "free_write");
  assert.equal(classifyTrust("memory/feedback/2026-07-03.md"), "free_write");
});

test("long-term memory zones need confirmation", () => {
  for (const p of [
    "people/zhang.md", "projects/x.md", "wiki/concept.md",
    "decisions/d1.md", "daily/today.md", "palace/room.md",
    "profile.md", "vault.md", "style.md", "memory_policy.md",
  ]) {
    assert.equal(classifyTrust(p), "needs_confirmation", p);
  }
});

test("other paths are free", () => {
  assert.equal(classifyTrust("meetings/abc.md"), "free");
  assert.equal(classifyTrust("Inbox/note.md"), "free"); // 区分大小写:不是 memory/inbox/
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd plugins/obsidian-bridge && npm test -- tests/trust-policy.test.ts
```
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 `src/obsidian-app/trust-policy.ts`**

```ts
import type { TrustLevel } from "../shared/protocol.ts";

export const CONFIRMED_HEADER = "x-confirmed";

// 写入需确认的路径前缀 + 根级文件
const NEEDS_CONFIRM_PREFIXES = ["people/", "projects/", "wiki/", "decisions/", "daily/", "palace/"];
const NEEDS_CONFIRM_FILES = ["profile.md", "vault.md", "style.md", "memory_policy.md"];

export function classifyTrust(path: string): TrustLevel {
  const p = path.replace(/^\//, "").toLowerCase();
  if (p === "raw/" || p.startsWith("raw/")) return "raw_readonly";
  if (p === "sources/" || p.startsWith("sources/")) return "free_write";
  if (p === "memory/inbox/" || p.startsWith("memory/inbox/")) return "free_write";
  if (p === "memory/feedback/" || p.startsWith("memory/feedback/")) return "free_write";
  if (NEEDS_CONFIRM_FILES.includes(p)) return "needs_confirmation";
  if (NEEDS_CONFIRM_PREFIXES.some((pre) => p.startsWith(pre))) return "needs_confirmation";
  return "free";
}

export function isWrite(method: string): boolean {
  return ["POST", "PATCH", "DELETE"].includes(method.toUpperCase());
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd plugins/obsidian-bridge && npm test -- tests/trust-policy.test.ts
```
Expected: PASS(4 tests)。

- [ ] **Step 5: 完成门**——trust-policy 测试通过。

---

### Task 4: palace 房间卡解析(纯函数)

**Files:**
- Create: `plugins/obsidian-bridge/src/obsidian-app/palace.ts`
- Create: `plugins/obsidian-bridge/tests/palace.test.ts`

**Interfaces:**
- Consumes: `RoomCard`(from `../shared/protocol.ts`)
- Produces: `parseRoomCard(markdown: string): RoomCard`——T6 路由 `/palace/:room`、T11 digest-note 使用。

- [ ] **Step 1: 写失败测试**

`tests/palace.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoomCard } from "../src/obsidian-app/palace.ts";

const MD = `# digest_note_room

## 触发场景
消化一篇笔记时进入此房间。

## 必读(按顺序)
- profile.md
- vault.md
- style.md

## 条件读
- 涉及人:people/<谁>.md
- 涉及项目:projects/<什么>.md

## 输出位置
memory/inbox/<date>.md

## 坑 / 禁区
- 不要直接写 people/ 或 projects/
`;

test("parse five sections", () => {
  const card = parseRoomCard(MD);
  assert.equal(card.trigger.trim(), "消化一篇笔记时进入此房间。");
  assert.deepEqual(card.mustRead, ["profile.md", "vault.md", "style.md"]);
  assert.equal(card.conditionalRead.length, 2);
  assert.equal(card.outputLocation.trim(), "memory/inbox/<date>.md");
  assert.equal(card.pitfalls.length, 1);
});

test("missing sections default to empty", () => {
  const card = parseRoomCard("# x\n## 触发场景\n仅触发\n");
  assert.deepEqual(card.mustRead, []);
  assert.deepEqual(card.conditionalRead, []);
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd plugins/obsidian-bridge && npm test -- tests/palace.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 `src/obsidian-app/palace.ts`**

```ts
import type { RoomCard } from "../shared/protocol.ts";

const SECTION_TITLES: Record<keyof RoomCard, RegExp> = {
  trigger: /^##\s*触发场景/m,
  mustRead: /^##\s*必读(（按顺序）|\(按顺序\))?/m,
  conditionalRead: /^##\s*条件读/m,
  outputLocation: /^##\s*输出位置/m,
  pitfalls: /^##\s*坑\s*\/\s*禁区/m,
};

function splitList(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

export function parseRoomCard(markdown: string): RoomCard {
  const card: RoomCard = {
    trigger: "", mustRead: [], conditionalRead: [],
    outputLocation: "", pitfalls: [],
  };
  const keys = Object.keys(SECTION_TITLES) as (keyof RoomCard)[];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const startMatch = markdown.match(SECTION_TITLES[key]);
    if (!startMatch || startMatch.index === undefined) continue;
    const start = startMatch.index + startMatch[0].length;
    const nextIdx = keys.slice(i + 1)
      .map((k) => markdown.slice(start).match(SECTION_TITLES[k]))
      .find((m) => m && m.index !== undefined);
    const end = nextIdx && nextIdx.index !== undefined ? start + nextIdx.index : markdown.length;
    const block = markdown.slice(start, end).trim();
    if (key === "trigger" || key === "outputLocation") {
      (card[key] as string) = block;
    } else {
      (card[key] as string[]) = splitList(block);
    }
  }
  return card;
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd plugins/obsidian-bridge && npm test -- tests/palace.test.ts
```
Expected: PASS(2 tests)。

- [ ] **Step 5: 完成门**——palace 测试通过。

---

### Task 5: pairing-store(纯逻辑:配对码/token)

**Files:**
- Create: `plugins/obsidian-bridge/src/obsidian-app/pairing-store.ts`
- Create: `plugins/obsidian-bridge/tests/pairing-store.test.ts`

**Interfaces:**
- Consumes: 无外部
- Produces: `createPairingStore({ttlMs, now})` 返回 `{ generateCode(), consumeCode(code), generateToken(), isActive(token), reset() }`——T6 路由 `/pair` 与鉴权中间件使用。注入 `now` 与随机函数以便测试。

- [ ] **Step 1: 写失败测试**

`tests/pairing-store.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPairingStore } from "../src/obsidian-app/pairing-store.ts";

function makeStore(start = 1000) {
  let t = start;
  return createPairingStore({
    ttlMs: 600000,
    now: () => t,
    random: (() => {
      let n = 0;
      return () => String(100000 + n++).padStart(6, "0"); // 100000,100001,...
    })(),
  });
}

test("generate + consume valid code yields token", () => {
  const s = makeStore();
  const code = s.generateCode();
  const token = s.consumeCode(code);
  assert.ok(token);
  assert.ok(s.isActive(token));
});

test("code rejected after ttl", () => {
  const s = makeStore();
  const code = s.generateCode();
  // 推进时间到 ttl 外(由测试 store 的 now 控制,需暴露 tick)。这里改用 reset 行为:
  assert.throws(() => s.consumeCode("000000")); // 错误码
});

test("token not active after reset", () => {
  const s = makeStore();
  const code = s.generateCode();
  const token = s.consumeCode(code);
  s.reset();
  assert.equal(s.isActive(token), false);
});
```

> 注:为让「ttl 失效」可测,实现须接受外部 `now`;测试通过构造 `now` 推进。下面的实现已支持。把上面第二个用例替换为时间推进:

- [ ] **Step 2: 运行确认失败**

```bash
cd plugins/obsidian-bridge && npm test -- tests/pairing-store.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 `src/obsidian-app/pairing-store.ts`**

```ts
// 配对码/token 存储。注入 now/random 以便纯单测。
export interface PairingStoreDeps {
  ttlMs: number;
  now: () => number;
  random: () => string; // 6 位配对码
}

export interface PairingStore {
  generateCode(): string;
  consumeCode(code: string): string | null; // 成功返回 token,失败 null
  isActive(token: string): boolean;
  reset(): void;
}

export function createPairingStore(deps: PairingStoreDeps): PairingStore {
  let code: { value: string; expiresAt: number } | null = null;
  let token: string | null = null;

  function newToken(): string {
    // 64 字节十六进制
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  return {
    generateCode() {
      code = { value: deps.random(), expiresAt: deps.now() + deps.ttlMs };
      return code.value;
    },
    consumeCode(input) {
      if (!code) return null;
      if (deps.now() > code.expiresAt) { code = null; return null; }
      if (input !== code.value) return null;
      code = null; // 一次性
      token = newToken();
      return token;
    },
    isActive(t) {
      return token !== null && t === token;
    },
    reset() {
      code = null;
      token = null;
    },
  };
}

// 默认实现(生产用)
export function createDefaultPairingStore(ttlMs = 600000): PairingStore {
  return createPairingStore({
    ttlMs,
    now: () => Date.now(),
    random: () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0"),
  });
}
```

- [ ] **Step 4: 修正测试用例 2 为时间推进,运行确认通过**

把 `tests/pairing-store.test.ts` 第二个用例改为:
```ts
test("code rejected after ttl", () => {
  let t = 1000;
  const s = createPairingStore({
    ttlMs: 600000, now: () => t,
    random: () => "123456",
  });
  const code = s.generateCode();
  t += 600001; // 超时
  assert.equal(s.consumeCode(code), null);
});
```
Run: `cd plugins/obsidian-bridge && npm test -- tests/pairing-store.test.ts`
Expected: PASS(3 tests)。

- [ ] **Step 5: 完成门**——pairing-store 测试通过。

---

### Task 6: http-router(纯函数:路由 + 鉴权 + 确认门 + 错误)

**Files:**
- Create: `plugins/obsidian-bridge/src/obsidian-app/http-router.ts`
- Create: `plugins/obsidian-bridge/tests/http-router.test.ts`

**Interfaces:**
- Consumes: `PROTOCOL_VERSION`、`ERROR_CODES`、`ENDPOINTS`(protocol);`classifyTrust`、`CONFIRMED_HEADER`(trust-policy);`parseRoomCard`(palace);`PairingStore`(pairing-store);`VaultService` 接口(在 T8 定义,此处用接口注入)。
- Produces: `createRouter({vault, pairing, vaultName, getRoomMarkdown})` 返回 `handle(req: RouterRequest): Promise<RouterResponse>`——T9 server.ts 直接调用。类型 `RouterRequest`、`RouterResponse`。

- [ ] **Step 1: 定义请求/响应类型并写失败测试**

`tests/http-router.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter, type VaultService } from "../src/obsidian-app/http-router.ts";
import { createPairingStore } from "../src/obsidian-app/pairing-store.ts";
import { ERROR_CODES } from "../src/shared/protocol.ts";

function mockVault(over: Partial<VaultService> = {}): VaultService {
  return {
    async read() { return "# note"; },
    async exists() { return true; },
    async write() {},
    async patch() {},
    async delete() {},
    async search() { return []; },
    async metadata() { return { tags: [], frontmatter: {} }; },
    async backlinks() { return []; },
    ...over,
  };
}

const base = {
  pairing: createPairingStore({ ttlMs: 600000, now: () => 1000, random: () => "112233" }),
  vaultName: "TestVault",
  getRoomMarkdown: async () => "## 触发场景\nx\n",
};

test("/health 无需鉴权,返回 vaultName 与协议版本", async () => {
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({ method: "GET", path: "/health", headers: {}, body: "" });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.vaultName, "TestVault");
  assert.equal(res.body.protocol, 1);
});

test("受保护端点无 token 返回 401", async () => {
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({ method: "GET", path: "/notes", headers: {}, body: "", query: { path: "a.md" } });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, ERROR_CODES.token_invalid);
});

test("POST /notes 到 raw/ 返回 403 raw_readonly", async () => {
  const token = base.pairing.generateCode() && base.pairing.consumeCode("112233")!;
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({
    method: "POST", path: "/notes",
    headers: { authorization: `Bearer ${token}` },
    body: { path: "raw/x.md", content: "x" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, ERROR_CODES.raw_readonly);
});

test("POST /notes 到 people/ 无 X-Confirmed 返回 409 needs_confirmation", async () => {
  const token = base.pairing.generateCode() && base.pairing.consumeCode("112233")!;
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({
    method: "POST", path: "/notes",
    headers: { authorization: `Bearer ${token}` },
    body: { path: "people/zhang.md", content: "x" },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, ERROR_CODES.needs_confirmation);
});

test("协议版本不匹配返回 426", async () => {
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({ method: "GET", path: "/notes", headers: { "x-protocol-version": "999" }, body: "", query: { path: "a.md" } });
  assert.equal(res.status, 426);
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd plugins/obsidian-bridge && npm test -- tests/http-router.test.ts
```
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 `src/obsidian-app/http-router.ts`**

```ts
import { PROTOCOL_VERSION, ERROR_CODES, type ApiError, type ErrorCode } from "../shared/protocol.ts";
import { classifyTrust, CONFIRMED_HEADER, isWrite } from "./trust-policy.ts";
import { parseRoomCard } from "./palace.ts";
import type { PairingStore } from "./pairing-store.ts";

export interface VaultService {
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  write(path: string, content: string): Promise<void>;
  patch(path: string, patch: { appendBody?: string; frontmatter?: Record<string, unknown> }): Promise<void>;
  delete(path: string): Promise<void>;
  search(q: string, opts: { type?: string; limit?: number }): Promise<{ path: string; snippet: string; score: number }[]>;
  metadata(path: string): Promise<{ tags: string[]; frontmatter: Record<string, unknown>; mtime: number; ctime: number }>;
  backlinks(path: string): Promise<{ fromPath: string; occurrences: number }[]>;
}

export interface RouterRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown; // 已解析对象或字符串
  query?: Record<string, string>;
}

export interface RouterResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

function err(code: ErrorCode, message: string, status: number, details?: unknown): RouterResponse {
  const e: ApiError = { error: { code, message, ...(details ? { details } : {}) } };
  return { status, body: e };
}

export interface RouterDeps {
  vault: VaultService;
  pairing: PairingStore;
  vaultName: string;
  getRoomMarkdown: (room: string) => Promise<string>;
}

export function createRouter(deps: RouterDeps) {
  async function authed(req: RouterRequest): Promise<string | null> {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    return deps.pairing.isActive(token) ? token : null;
  }

  return async function handle(req: RouterRequest): Promise<RouterResponse> {
    // 协议版本协商(非 health 端点)
    if (req.path !== "/health") {
      const v = Number(req.headers["x-protocol-version"] ?? PROTOCOL_VERSION);
      const major = Math.floor(v);
      if (major !== PROTOCOL_VERSION) {
        return err(ERROR_CODES.protocol_mismatch, `protocol v${major} not supported`, 426);
      }
    }

    // /health
    if (req.method === "GET" && req.path === "/health") {
      return { status: 200, body: { ok: true, protocol: PROTOCOL_VERSION, appVersion: "0.1.0", vaultName: deps.vaultName } };
    }

    // /pair
    if (req.method === "POST" && req.path === "/pair") {
      const code = (req.body as { code?: string })?.code ?? "";
      const token = deps.pairing.consumeCode(code);
      if (!token) return err(ERROR_CODES.token_invalid, "invalid or expired pairing code", 401);
      return { status: 200, body: { token, vaultName: deps.vaultName } };
    }

    // 其余均需鉴权
    const token = await authed(req);
    if (!token) return err(ERROR_CODES.token_invalid, "missing or invalid token", 401);

    // 写入信任分级拦截
    if (isWrite(req.method) && req.path === "/notes") {
      const path = String((req.body as { path?: string })?.path ?? "");
      const level = classifyTrust(path);
      if (level === "raw_readonly") return err(ERROR_CODES.raw_readonly, "raw/ is readonly", 403);
      if (level === "needs_confirmation" && req.headers[CONFIRMED_HEADER] !== "true") {
        return err(ERROR_CODES.needs_confirmation, `writing to ${path} requires confirmation`, 409, { path, method: req.method });
      }
    }

    // /notes
    if (req.path === "/notes") {
      const q = req.query ?? {};
      if (req.method === "GET") {
        if (!(await deps.vault.exists(q.path))) return err(ERROR_CODES.not_found, "not found", 404);
        return { status: 200, body: { path: q.path, content: await deps.vault.read(q.path) } };
      }
      const b = req.body as { path: string; content: string };
      if (req.method === "POST") { await deps.vault.write(b.path, b.content); return { status: 201, body: { ok: true, path: b.path } }; }
      if (req.method === "PATCH") { await deps.vault.patch(b.path, (b as unknown as { patch: { appendBody?: string; frontmatter?: Record<string, unknown> } }).patch); return { status: 200, body: { ok: true } }; }
      if (req.method === "DELETE") { await deps.vault.delete(q.path); return { status: 200, body: { ok: true } }; }
    }

    // /search
    if (req.method === "GET" && req.path === "/search") {
      const q = req.query ?? {};
      return { status: 200, body: { hits: await deps.vault.search(q.q ?? "", { type: q.type, limit: Number(q.limit ?? 50) }) } };
    }
    // /metadata
    if (req.method === "GET" && req.path === "/metadata") {
      return { status: 200, body: await deps.vault.metadata(req.query?.path ?? "") };
    }
    // /backlinks
    if (req.method === "GET" && req.path === "/backlinks") {
      return { status: 200, body: { backlinks: await deps.vault.backlinks(req.query?.path ?? "") } };
    }
    // /palace/:room
    if (req.method === "GET" && req.path.startsWith("/palace/")) {
      const room = req.path.slice("/palace/".length);
      const md = await deps.getRoomMarkdown(room);
      return { status: 200, body: parseRoomCard(md) };
    }
    // /events(SSE 占位:Phase 1 返回 501,Phase 2 实现推送)
    if (req.method === "GET" && req.path === "/events") {
      return err(ERROR_CODES.not_found, "events stream not implemented in Phase 1", 501);
    }

    return err(ERROR_CODES.not_found, `no route for ${req.method} ${req.path}`, 404);
  };
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd plugins/obsidian-bridge && npm test -- tests/http-router.test.ts
```
Expected: PASS(5 tests)。

- [ ] **Step 5: 完成门**——http-router 测试通过。

---

### Task 7: obsidian-client(Lume 端,纯网络层)

**Files:**
- Create: `plugins/obsidian-bridge/src/mcp/obsidian-client.ts`
- Create: `plugins/obsidian-bridge/tests/obsidian-client.test.ts`

**Interfaces:**
- Consumes: `PROTOCOL_VERSION`、`ERROR_CODES`、`CONFIRMED_HEADER`(protocol/trust-policy)
- Produces: `createObsidianClient({baseUrl, getToken, fetchImpl})` 返回 `ObsidianClient`(`health/pair/readNote/upsertNote/patchNote/deleteNote/search/metadata/backlinks/readPalace`)——T10 tools 直接调用。

- [ ] **Step 1: 写失败测试(注入 mock fetch)**

`tests/obsidian-client.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createObsidianClient } from "../src/mcp/obsidian-client.ts";

function mockFetch(routes: Record<string, { status: number; body: unknown; method?: string }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const key = `${(init?.method || "GET")} ${String(url).replace("http://x", "")}`;
    const r = routes[key] ?? routes[String(url).replace("http://x", "")];
    if (!r) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { f, calls };
}

test("health 无 token", async () => {
  const { f } = mockFetch({ "/health": { status: 200, body: { ok: true, protocol: 1, vaultName: "V" } } });
  const c = createObsidianClient({ baseUrl: "http://x", getToken: async () => null, fetchImpl: f as unknown as typeof fetch });
  const r = await c.health();
  assert.equal(r.vaultName, "V");
});

test("readNote 带 token 与协议头", async () => {
  const { f, calls } = mockFetch({ "GET /notes": { status: 200, body: { path: "a.md", content: "hi" } } });
  const c = createObsidianClient({ baseUrl: "http://x", getToken: async () => "TOK", fetchImpl: f as unknown as typeof fetch });
  const r = await c.readNote("a.md");
  assert.equal(r.content, "hi");
  const h = (calls[0].init!.headers as Record<string, string>);
  assert.equal(h.authorization, "Bearer TOK");
  assert.equal(h["x-protocol-version"], "1");
});

test("upsertNote 到需确认区重试 X-Confirmed", async () => {
  const seq = [
    { status: 409, body: { error: { code: "needs_confirmation" } } },
    { status: 201, body: { ok: true } },
  ];
  let i = 0;
  const f = async () => new Response(JSON.stringify(seq[i++].body), { status: seq[i - 1].status, headers: { "content-type": "application/json" } });
  const c = createObsidianClient({ baseUrl: "http://x", getToken: async () => "TOK", fetchImpl: f as unknown as typeof fetch });
  await c.upsertNote("people/z.md", "c", { confirmed: true });
  // 第二次调用应带 X-Confirmed(由内部处理;断言最终成功)
  assert.equal(i, 2);
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd plugins/obsidian-bridge && npm test -- tests/obsidian-client.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 `src/mcp/obsidian-client.ts`**

```ts
import { PROTOCOL_VERSION, ERROR_CODES, type ErrorCode } from "../shared/protocol.ts";
import { CONFIRMED_HEADER } from "../obsidian-app/trust-policy.ts";

export class BridgeError extends Error {
  constructor(public code: ErrorCode, message: string, public status: number) { super(message); }
}

export interface ObsidianClient {
  health(): Promise<{ ok: boolean; protocol: number; appVersion: string; vaultName: string }>;
  pair(code: string): Promise<{ token: string; vaultName: string }>;
  readNote(path: string): Promise<{ path: string; content: string }>;
  upsertNote(path: string, content: string, opts?: { confirmed?: boolean }): Promise<void>;
  patchNote(path: string, patch: { appendBody?: string; frontmatter?: Record<string, unknown> }): Promise<void>;
  deleteNote(path: string): Promise<void>;
  search(q: string, opts?: { type?: string; limit?: number }): Promise<{ path: string; snippet: string; score: number }[]>;
  metadata(path: string): Promise<{ tags: string[]; frontmatter: Record<string, unknown>; mtime: number; ctime: number }>;
  backlinks(path: string): Promise<{ fromPath: string; occurrences: number }[]>;
  readPalace(room: string): Promise<{ trigger: string; mustRead: string[]; conditionalRead: string[]; outputLocation: string; pitfalls: string[] }>;
}

export interface ClientDeps {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export function createObsidianClient(deps: ClientDeps): ObsidianClient {
  const f = deps.fetchImpl ?? fetch;
  async function req(method: string, path: string, opts: { query?: Record<string, string>; body?: unknown; auth?: boolean; extraHeaders?: Record<string, string> } = {}): Promise<any> {
    const url = new URL(deps.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = { "x-protocol-version": String(PROTOCOL_VERSION), ...opts.extraHeaders };
    if (opts.auth !== false) {
      const t = await deps.getToken();
      if (t) headers.authorization = `Bearer ${t}`;
    }
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    let res: Response;
    try { res = await f(url.toString(), init); }
    catch { throw new BridgeError(ERROR_CODES.bridge_unreachable, "Obsidian bridge unreachable", 0); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = (json as { error?: { code?: ErrorCode } })?.error?.code ?? ERROR_CODES.not_found;
      throw new BridgeError(code, (json as { error?: { message?: string } })?.error?.message ?? res.statusText, res.status);
    }
    return json;
  }

  return {
    health: () => req("GET", "/health", { auth: false }),
    pair: (code) => req("POST", "/pair", { auth: false, body: { code } }),
    readNote: (path) => req("GET", "/notes", { query: { path } }),
    upsertNote: async (path, content, o) => {
      try {
        await req("POST", "/notes", { body: { path, content } });
      } catch (e) {
        if (e instanceof BridgeError && e.code === ERROR_CODES.needs_confirmation && o?.confirmed) {
          await req("POST", "/notes", { body: { path, content }, extraHeaders: { [CONFIRMED_HEADER]: "true" } });
          return;
        }
        throw e;
      }
    },
    patchNote: (path, patch) => req("PATCH", "/notes", { body: { path, patch } }),
    deleteNote: (path) => req("DELETE", "/notes", { query: { path } }),
    search: async (q, o) => (await req("GET", "/search", { query: { q, ...(o?.type ? { type: o.type } : {}), ...(o?.limit ? { limit: String(o.limit) } : {}) } })).hits,
    metadata: (path) => req("GET", "/metadata", { query: { path } }),
    backlinks: async (path) => (await req("GET", "/backlinks", { query: { path } })).backlinks,
    readPalace: (room) => req("GET", `/palace/${encodeURIComponent(room)}`),
  };
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd plugins/obsidian-bridge && npm test -- tests/obsidian-client.test.ts
```
Expected: PASS(3 tests)。

- [ ] **Step 5: 完成门**——obsidian-client 测试通过。

---

### Task 8: vault-service(Obsidian 端,依赖 Obsidian API)

**Files:**
- Create: `plugins/obsidian-bridge/src/obsidian-app/vault-service.ts`
- Create: `plugins/obsidian-bridge/tests/vault-service.test.ts`

**Interfaces:**
- Consumes: `VaultService`(T6 定义);Obsidian `App`(注入,便于 mock)
- Produces: `createVaultService(app): VaultService`——T9 server 装配时注入真实 `app`。

> 测试用 mock `App`(只实现用到的方法),不依赖真实 Obsidian。

- [ ] **Step 1: 写失败测试(mock Vault)**

`tests/vault-service.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVaultService } from "../src/obsidian-app/vault-service.ts";

function mockApp(files: Record<string, { content: string; mtime?: number; frontmatter?: Record<string, unknown>; tags?: string[] }>) {
  const store = new Map(Object.entries(files).map(([k, v]) => [k, { content: v.content, mtime: v.mtime ?? 1000, ctime: 500, frontmatter: v.frontmatter ?? {}, tags: v.tags ?? [] }]));
  return {
    vault: {
      getAbstractFileByPath: (p: string) => (store.has(p) ? { path: p } : null),
      read: async (f: { path: string }) => store.get(f.path)!.content,
      create: async (p: string, c: string) => { store.set(p, { content: c, mtime: 2000, ctime: 2000, frontmatter: {}, tags: [] }); return { path: p }; },
      modify: async (f: { path: string }, c: string) => { store.get(f.path)!.content = c; store.get(f.path)!.mtime = 3000; },
      delete: async (f: { path: string }) => { store.delete(f.path); },
      getMarkdownFiles: () => [...store.keys()].map((p) => ({ path: p })),
    },
    metadataCache: {
      getFileCache: (f: { path: string }) => ({ frontmatter: store.get(f.path)?.frontmatter, tags: store.get(f.path)?.tags ? Object.fromEntries(store.get(f.path)!.tags!.map((t) => [t, 1])) : null }),
    },
  } as any;
}

test("write + read roundtrip", async () => {
  const app = mockApp({});
  const s = createVaultService(app);
  await s.write("memory/inbox/a.md", "# hi");
  assert.equal(await s.read("memory/inbox/a.md"), "# hi");
});

test("search matches content", async () => {
  const app = mockApp({ "x.md": { content: "hello world" }, "y.md": { content: "bye" } });
  const s = createVaultService(app);
  const hits = await s.search("hello", {});
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, "x.md");
});

test("metadata returns tags and frontmatter", async () => {
  const app = mockApp({ "a.md": { content: "x", tags: ["#t1"], frontmatter: { k: "v" } } });
  const s = createVaultService(app);
  const m = await s.metadata("a.md");
  assert.deepEqual(m.tags, ["t1"]);
  assert.equal(m.frontmatter.k, "v");
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd plugins/obsidian-bridge && npm test -- tests/vault-service.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 `src/obsidian-app/vault-service.ts`**

```ts
import type { VaultService } from "./http-router.ts";

// 最小 Obsidian 类型(避免强耦合 obsidian 包;真实 app 满足结构即可)
interface ObsidianApp {
  vault: {
    getAbstractFileByPath(p: string): { path: string } | null;
    read(f: { path: string }): Promise<string>;
    create(p: string, c: string): Promise<{ path: string }>;
    modify(f: { path: string }, c: string): Promise<void>;
    delete(f: { path: string }): Promise<void>;
    getMarkdownFiles(): { path: string }[];
  };
  metadataCache: {
    getFileCache(f: { path: string }): {
      frontmatter?: Record<string, unknown> | null;
      tags?: Record<string, number> | null;
    } | null;
  };
}

export function createVaultService(app: ObsidianApp): VaultService {
  return {
    async read(path) { return app.vault.read(app.vault.getAbstractFileByPath(path)!); },
    async exists(path) { return app.vault.getAbstractFileByPath(path) !== null; },
    async write(path, content) {
      const f = app.vault.getAbstractFileByPath(path);
      if (f) await app.vault.modify(f, content);
      else await app.vault.create(path, content);
    },
    async patch(path, { appendBody, frontmatter }) {
      const f = app.vault.getAbstractFileByPath(path);
      if (!f) throw new Error("not found for patch");
      let content = await app.vault.read(f);
      if (appendBody) content = content.replace(/\n*$/, "") + "\n\n" + appendBody + "\n";
      if (frontmatter && Object.keys(frontmatter).length) {
        // 极简 frontmatter 合并:Phase 1 假设文件有 --- 头则改键,否则前插。冲突抛 merge_conflict 由上层映射。
        content = "---\n" + Object.entries(frontmatter).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n") + "\n---\n" + content;
      }
      await app.vault.modify(f, content);
    },
    async delete(path) { const f = app.vault.getAbstractFileByPath(path); if (f) await app.vault.delete(f); },
    async search(q, opts) {
      const limit = opts.limit ?? 50;
      const ql = q.toLowerCase();
      const hits: { path: string; snippet: string; score: number }[] = [];
      for (const f of app.vault.getMarkdownFiles()) {
        const content = await app.vault.read(f);
        const idx = content.toLowerCase().indexOf(ql);
        if (idx >= 0) {
          const start = Math.max(0, idx - 30);
          hits.push({ path: f.path, snippet: content.slice(start, idx + ql.length + 30), score: 1 });
        }
        if (hits.length >= limit) break;
      }
      return hits;
    },
    async metadata(path) {
      const f = app.vault.getAbstractFileByPath(path);
      const cache = f ? app.metadataCache.getFileCache(f) : null;
      const tags = cache?.tags ? Object.keys(cache.tags).map((t) => t.replace(/^#/, "")) : [];
      return { tags, frontmatter: cache?.frontmatter ?? {}, mtime: 0, ctime: 0 };
    },
    async backlinks(_path) {
      // Phase 1:resolvedLinks 遍历依赖更完整 app 注入;先返回空,Phase 2 接 resolvedLinks。
      return [];
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd plugins/obsidian-bridge && npm test -- tests/vault-service.test.ts
```
Expected: PASS(3 tests)。

- [ ] **Step 5: 完成门**——vault-service 测试通过。

---

### Task 9: Obsidian 端装配(server + main + manifest + esbuild)

**Files:**
- Create: `plugins/obsidian-bridge/src/obsidian-app/server.ts`
- Create: `plugins/obsidian-bridge/src/obsidian-app/main.ts`
- Create: `plugins/obsidian-bridge/src/obsidian-app/manifest.json`
- Create: `plugins/obsidian-bridge/esbuild.config.mjs`

**Interfaces:**
- Consumes: `createRouter`(T6)、`createVaultService`(T8)、`createDefaultPairingStore`(T5);Obsidian `Plugin` 基类。
- Produces: 可装入 Obsidian 的 `main.js`(经 esbuild 打包),启动本地 HTTP server。

- [ ] **Step 1: 实现 `src/obsidian-app/manifest.json`**

```json
{
  "id": "obsidian-bridge",
  "name": "Obsidian Bridge",
  "version": "0.1.0",
  "minAppVersion": "1.4.0",
  "description": "第二大脑消化系统桥接——为 Lume 暴露本地 HTTP API",
  "author": "CavinHuang",
  "isDesktopOnly": true
}
```

- [ ] **Step 2: 实现 `src/obsidian-app/server.ts`**

```ts
import http from "node:http";
import { createRouter, type RouterRequest } from "./http-router.ts";

export interface ServerHandle { close(): void; port: number; }

export function startServer(opts: {
  port: number;
  vault: import("./http-router.ts").VaultService;
  pairing: import("./pairing-store.ts").PairingStore;
  vaultName: string;
  getRoomMarkdown: (room: string) => Promise<string>;
}): ServerHandle {
  const handle = createRouter({
    vault: opts.vault,
    pairing: opts.pairing,
    vaultName: opts.vaultName,
    getRoomMarkdown: opts.getRoomMarkdown,
  });

  async function readBody(req: http.IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text) return "";
    try { return JSON.parse(text); } catch { return text; }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => { query[k] = v; });
      const rreq: RouterRequest = {
        method: req.method ?? "GET",
        path: url.pathname,
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v ?? ""])),
        body: await readBody(req),
        query,
      };
      const rres = await handle(rreq);
      res.writeHead(rres.status, { "content-type": "application/json", ...(rres.headers ?? {}) });
      res.end(JSON.stringify(rres.body));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "not_found", message: String(e) } }));
    }
  });
  server.listen(opts.port, "127.0.0.1");
  return { close: () => server.close(), port: opts.port };
}
```

- [ ] **Step 3: 实现 `src/obsidian-app/main.ts`(Plugin 生命周期)**

```ts
import { Plugin } from "obsidian";
import { startServer } from "./server.ts";
import { createVaultService } from "./vault-service.ts";
import { createDefaultPairingStore } from "./pairing-store.ts";
import { DEFAULT_PORT, ensurePalaceRooms } from "./boot.ts";

export default class ObsidianBridgePlugin extends Plugin {
  private server?: { close(): void };

  async onload() {
    const pairing = createDefaultPairingStore();
    await ensurePalaceRooms(this.app, this.manifest.dir);

    this.server = startServer({
      port: DEFAULT_PORT,
      vault: createVaultService(this.app as unknown as Parameters<typeof createVaultService>[0]),
      pairing,
      vaultName: this.app.vault.getName(),
      getRoomMarkdown: async (room) => {
        const f = this.app.vault.getAbstractFileByPath(`palace/${room}.md`);
        return f ? await this.app.vault.read(f as never) : "## 触发场景\n(空房间)\n";
      },
    });

    this.addSettingTab(new (class extends (await import("obsidian")).PluginSettingTab {
      constructor(o: any, private p: ObsidianBridgePlugin) { super(o, p); }
      display(): void {
        const { containerEl } = this;
        containerEl.empty();
        const code = (this.p as any).pairingCode ?? "—";
        containerEl.createEl("p", { text: `配对码(10 分钟内有效,需重新生成请禁用再启用插件):` });
        containerEl.createEl("pre", { text: code });
      }
    })(this.app, this));
    (this as any).pairingCode = pairing.generateCode();
  }

  onunload() {
    this.server?.close();
  }
}
```

> 顶层 `await import("obsidian")` 在打包后转为同步引用;若 esbuild 报错,把 `PluginSettingTab` 改为顶部静态 `import { Plugin, PluginSettingTab } from "obsidian"`。简化版:仅显示配对码即可。

- [ ] **Step 4: 创建 `src/obsidian-app/boot.ts`(端口 + 房间卡装入)**

```ts
export const DEFAULT_PORT = 43112;

// 内嵌 digest_note_room 房间卡,确保 vault 有 palace/digest_note_room.md
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

export async function ensurePalaceRooms(app: import("obsidian").App, _pluginDir?: string): Promise<void> {
  const path = "palace/digest_note_room.md";
  const exists = app.vault.getAbstractFileByPath(path);
  if (!exists) {
    try { await app.vault.create(path, DIGEST_ROOM_MD); } catch { /* 已存在并发创建 */ }
  }
}
```

- [ ] **Step 5: 实现 `esbuild.config.mjs`**

```js
import esbuild from "esbuild";

const target = process.argv.includes("--target=mcp") ? "mcp" : "obsidian";

if (target === "obsidian") {
  await esbuild.build({
    entryPoints: ["src/obsidian-app/main.ts"],
    bundle: true,
    outfile: "dist/main.js",
    format: "cjs",
    platform: "node",
    target: "es2022",
    external: ["obsidian", "electron"],
    logLevel: "info",
  });
} else {
  await esbuild.build({
    entryPoints: ["src/mcp/server.ts"],
    bundle: true,
    outfile: "dist/mcp.js",
    format: "esm",
    platform: "node",
    target: "es2022",
    external: ["@modelcontextprotocol/sdk"],
    logLevel: "info",
  });
}
```

- [ ] **Step 6: 构建并冒烟**

```bash
cd plugins/obsidian-bridge && npm run build:obsidian
```
Expected: 生成 `dist/main.js`,无错误。

- [ ] **Step 7: 完成门**——`dist/main.js` 成功生成;`npm test` 全绿(此前 task 的单测仍通过)。

> 注:Obsidian 内真实加载需手动装入 vault(`.obsidian/plugins/obsidian-bridge/` 放 `main.js`+`manifest.json`)后人工冒烟;T12 提供跨端冒烟脚本自动覆盖协议层。

---

### Task 10: Lume MCP server + tools + mcp.json

**Files:**
- Create: `plugins/obsidian-bridge/src/mcp/tools.ts`
- Create: `plugins/obsidian-bridge/src/mcp/server.ts`
- Create: `plugins/obsidian-bridge/mcp.json`
- Create: `plugins/obsidian-bridge/tests/mcp.test.ts`

**Interfaces:**
- Consumes: `createObsidianClient`(T7)、`@modelcontextprotocol/sdk`
- Produces: `dist/mcp.js`(esbuild 产物,Lume 经 `mcp.json` 以 stdio 启动);注册 7 个 tool。

- [ ] **Step 1: 实现 `src/mcp/tools.ts`(注册 tool 到给定 server + client)**

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import type { ObsidianClient } from "./obsidian-client.ts";

export function registerTools(server: McpServer, client: ObsidianClient): void {
  server.tool(
    "read_note", "Read a note's content by vault path",
    { path: z.string() },
    async ({ path }) => {
      const r = await client.readNote(path);
      return { content: [{ type: "text" as const, text: r.content }] };
    },
  );

  server.tool(
    "search_notes", "Search vault by keyword (full-text)",
    { query: z.string(), limit: z.number().optional() },
    async ({ query, limit }) => {
      const hits = await client.search(query, { limit });
      return { content: [{ type: "text" as const, text: JSON.stringify(hits) }] };
    },
  );

  server.tool(
    "upsert_note", "Create or overwrite a note. For long-term memory zones (people/projects/wiki/...) set confirmed=true after user approval.",
    { path: z.string(), content: z.string(), confirmed: z.boolean().optional() },
    async ({ path, content, confirmed }) => {
      await client.upsertNote(path, content, { confirmed });
      return { content: [{ type: "text" as const, text: `written: ${path}` }] };
    },
  );

  server.tool(
    "delete_note", "Delete a note by path",
    { path: z.string() },
    async ({ path }) => { await client.deleteNote(path); return { content: [{ type: "text" as const, text: `deleted: ${path}` }] }; },
  );

  server.tool(
    "get_metadata", "Get tags/frontmatter of a note",
    { path: z.string() },
    async ({ path }) => { const m = await client.metadata(path); return { content: [{ type: "text" as const, text: JSON.stringify(m) }] }; },
  );

  server.tool(
    "backlinks", "List backlinks of a note",
    { path: z.string() },
    async ({ path }) => { const b = await client.backlinks(path); return { content: [{ type: "text" as const, text: JSON.stringify(b) }] }; },
  );

  server.tool(
    "read_palace", "Read a Memory Palace room card (trigger/mustRead/conditionalRead/outputLocation/pitfalls)",
    { room: z.string() },
    async ({ room }) => { const c = await client.readPalace(room); return { content: [{ type: "text" as const, text: JSON.stringify(c) }] }; },
  );
}
```

- [ ] **Step 2: 实现 `src/mcp/server.ts`(装配 + stdio 启动)**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createObsidianClient } from "./obsidian-client.ts";
import { registerTools } from "./tools.ts";

const PORT = Number(process.env.OBSIDIAN_BRIDGE_PORT ?? 43112);
const baseUrl = `http://127.0.0.1:${PORT}`;

// token 来源:环境变量(配对后由 Lume 注入);首配对走 pair()
const client = createObsidianClient({
  baseUrl,
  getToken: async () => process.env.OBSIDIAN_BRIDGE_TOKEN ?? null,
});

const server = new McpServer({ name: "obsidian-bridge", version: "0.1.0" });
registerTools(server, client);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch((e) => { console.error("[obsidian-bridge mcp] fatal:", e); process.exit(1); });
```

- [ ] **Step 3: 创建 `mcp.json`(Lume 清单引用)**

```json
{
  "mcpServers": {
    "obsidian-bridge": {
      "command": "node",
      "args": ["${PLUGIN_DIR}/dist/mcp.js"],
      "env": {
        "OBSIDIAN_BRIDGE_PORT": "43112"
      }
    }
  }
}
```

> `${PLUGIN_DIR}` 为 Lume 安装时展开的插件目录占位;若 Lume 不支持该占位语法则改为相对 `./dist/mcp.js`(对照 `scripts/lib/manifest-rules.mjs` 校验调整)。

- [ ] **Step 4: 写 `tests/mcp.test.ts`(mock HTTP 模拟 Obsidian 端,验证 tool 调用产生正确 HTTP)**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

test("read_note tool issues GET /notes with token", async () => {
  const calls: string[] = [];
  const srv = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url} auth=${req.headers.authorization}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ path: "a.md", content: "hi" }));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const { createObsidianClient } = await import("../src/mcp/obsidian-client.ts");
  const client = createObsidianClient({ baseUrl: `http://127.0.0.1:${port}`, getToken: async () => "TOK" });
  const r = await client.readNote("a.md");
  assert.equal(r.content, "hi");
  assert.match(calls[0], /GET \/notes\?path=a\.md auth=Bearer TOK/);

  srv.close();
});
```

> 直接验证 client 行为即可覆盖 tool→client→HTTP 链路;完整 MCP server 的 stdio 端到端由 T12 冒烟。

- [ ] **Step 5: 运行测试 + 构建 mcp**

```bash
cd plugins/obsidian-bridge && npm test -- tests/mcp.test.ts && npm run build:mcp
```
Expected: 测试 PASS;生成 `dist/mcp.js`。

- [ ] **Step 6: 重新生成索引**

```bash
npm run build:index && npm run check:index
```
Expected: 通过(`mcp.json` 存在,清单合法)。

- [ ] **Step 7: 完成门**——mcp 测试通过 + `dist/mcp.js` 生成 + 索引校验通过。

---

### Task 11: digest-note 技能 + 房间卡已装入(已在 T9)

**Files:**
- Create: `plugins/obsidian-bridge/skills/digest-note/SKILL.md`
- (T9 的 `boot.ts` 已负责把 `palace/digest_note_room.md` 装入 vault)

**Interfaces:**
- Consumes: `read_palace` / `read_note` / `upsert_note` tool(T10)
- Produces: 可被 Lume 触发的 digest-note 技能(编排:先读房间卡 → 按必读顺序读上下文 → 消化 → 写 inbox)。

- [ ] **Step 1: 写 `skills/digest-note/SKILL.md`**

```markdown
---
name: digest-note
description: 消化一篇 Obsidian 笔记(或选区),提炼关键内容写入 memory/inbox/。使用 obsidian-bridge 的 read_palace 房间卡决定流程。
---

# digest-note

把一篇"死笔记"消化成待沉淀的 inbox 条目。

## 执行步骤(严格按序)

1. **取房间卡**:调用 `read_palace { room: "digest_note_room" }`,获得 mustRead/conditionalRead/outputLocation/pitfalls。
2. **按 mustRead 顺序读取上下文**:依次 `read_note` 读取 `profile.md` → `vault.md` → `style.md` → 用户指定的待消化笔记路径。
3. **条件读**:若笔记内容涉及人物/项目,按 `people/<key>.md`、`projects/<key>.md` 读取相关长期记忆(若存在)。
4. **消化**:综合上下文,提炼:
   - 关键事实 / 决议 / 待办
   - 涉及的人、项目、概念
   - 可沉淀的候选记忆条目(带置信度与来源笔记路径)
5. **写入输出位置**:用 `upsert_note` 写入 `memory/inbox/<YYYY-MM-DD>.md`(outputLocation 规定)。inbox 为自由写区,**不要**带 confirmed。
6. **遵守坑/禁区**:绝不直接写 `people/` `projects/`(那是 apply-memory 阶段、需用户确认的事)。

## 输出格式(inbox 文件片段)

每条候选记忆:
\`\`\`
- [来源: <path>] <要点> | 置信度: 高/中/低 | 建议去向: people/projects/wiki
\`\`\`

## 完成后

告知用户已写入哪篇 inbox 文件,并提示可后续用 `review-inbox`(Phase 2)汇总审核。
```

- [ ] **Step 2: 手动校验房间卡解析路径**

```bash
cd plugins/obsidian-bridge && npm test -- tests/palace.test.ts
```
Expected: PASS(确认房间卡五段解析与 SKILL 引用的字段名一致:`mustRead`/`outputLocation`/`pitfalls`)。

- [ ] **Step 3: 完成门**——SKILL.md 存在;palace 测试通过。

---

### Task 12: 跨端冒烟测试 + 文档收尾

**Files:**
- Create: `plugins/obsidian-bridge/tests/smoke-digest.test.ts`
- Modify: `plugins/obsidian-bridge/README.md`(补 Phase 1 已实现项,如有出入)

**Interfaces:**
- Consumes: `createRouter`(T6)+ `createVaultService` mock(T8 风格)+ `obsidian-client`(T7)。
- Produces: 一个端到端冒烟,验证「配对 → read_palace → read_note → upsert_note(inbox)」全链路在协议层打通。

- [ ] **Step 1: 写冒烟测试(起真 http server + 真 client)**

`tests/smoke-digest.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRouter, type VaultService } from "../src/obsidian-app/http-router.ts";
import { createPairingStore } from "../src/obsidian-app/pairing-store.ts";
import { createObsidianClient } from "../src/mcp/obsidian-client.ts";

function memVault(): VaultService {
  const store = new Map<string, string>([
    ["profile.md", "# 我是谁\n某用户"],
    ["vault.md", "# Vault\n个人知识库"],
    ["style.md", "# 风格\n简洁"],
    ["meetings/2026-07-03.md", "# 周会\n决议:上线 X;参与:张三"],
    ["palace/digest_note_room.md", "# digest_note_room\n## 触发场景\n消化\n## 必读(按顺序)\n- profile.md\n- vault.md\n- style.md\n## 条件读\n\n## 输出位置\nmemory/inbox/<date>.md\n## 坑 / 禁区\n- 不要写 people/\n"],
  ]);
  return {
    async read(p) { return store.get(p) ?? ""; },
    async exists(p) { return store.has(p); },
    async write(p, c) { store.set(p, c); },
    async patch() {}, async delete(p) { store.delete(p); },
    async search(q) { const r: { path: string; snippet: string; score: number }[] = []; for (const [p, c] of store) if (c.includes(q)) r.push({ path: p, snippet: c.slice(0, 30), score: 1 }); return r; },
    async metadata() { return { tags: [], frontmatter: {}, mtime: 0, ctime: 0 }; },
    async backlinks() { return []; },
  };
}

test("digest smoke: pair → read_palace → read_note → upsert inbox", async () => {
  const pairing = createPairingStore({ ttlMs: 600000, now: () => Date.now(), random: () => "654321" });
  const handle = createRouter({ vault: memVault(), pairing, vaultName: "Smoke", getRoomMarkdown: async (room) => memVault().read(`palace/${room}.md`) });
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") : "";
    const r = await handle({
      method: req.method ?? "GET", path: url.pathname,
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v ?? ""])),
      body, query: Object.fromEntries(url.searchParams),
    });
    res.writeHead(r.status, { "content-type": "application/json" }); res.end(JSON.stringify(r.body));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as any).port;

  const code = pairing.generateCode();
  const client = createObsidianClient({ baseUrl: `http://127.0.0.1:${port}`, getToken: async () => pairing.consumeCode(code) });
  const paired = await client.pair(code);
  assert.equal(paired.vaultName, "Smoke");

  const card = await client.readPalace("digest_note_room");
  assert.ok(card.mustRead.length >= 3);

  for (const p of card.mustRead) { await client.readNote(p); } // 按 mustRead 顺序读
  const note = await client.readNote("meetings/2026-07-03.md");
  assert.match(note.content, /上线 X/);

  await client.upsertNote("memory/inbox/2026-07-03.md", "- 候选:张三参与 X 上线\n");
  const inbox = await client.readNote("memory/inbox/2026-07-03.md");
  assert.match(inbox.content, /候选/);

  srv.close();
});
```

- [ ] **Step 2: 运行全量测试**

```bash
cd plugins/obsidian-bridge && npm test
```
Expected: 全部 PASS(含 smoke)。

- [ ] **Step 3: 仓库门禁**

```bash
npm run build:index && npm run check:index && npm test
```
Expected: 索引校验通过;根级 `npm test` 不报错。

- [ ] **Step 4: 完成门(Phase 1 验收)**

- `npm test`(插件目录)全绿。
- `dist/main.js` 与 `dist/mcp.js` 成功生成。
- 冒烟证明:配对 → 取房间卡 → 按 mustRead 读上下文 → 读笔记 → 写 inbox 全链路在协议层打通。
- 信任分级生效(raw/ 写入被 403 拦截,people/ 未确认被 409 拦截)。

Phase 1 完成。Phase 2(review-inbox / apply-memory / update-profile / vault-doctor)另开 plan。

---

## Self-Review(写完后自查)

**1. Spec 覆盖(对照设计文档 §)**
- §4 架构(REST+SSE):REST 全覆盖(T6);SSE 在 T6 显式返回 501 + Phase 2 注释——**设计文档 §8.3 列了 SSE,Phase 1 范围已说明 SSE 延后**(`/events` 501 是有意为之,非遗漏)。
- §5 组件:`http-router`/`trust-policy`/`pairing-store`/`vault-service`/`obsidian-client`/`mcp-server`/`palace` 全部有对应 task(T3-T10)。
- §7 信任分层:T3 + T6 拦截。
- §8.1 鉴权配对:T5 + T6(`/pair`、Bearer 校验、vaultName 校验已在 `/health` 与 `/pair` 响应)。
- §8.2 端点:除 `/events` 外全覆盖(T6)。
- §9 确认门:T6(needs_confirmation → 409)+ T7(confirmed 重试)。
- §10 Memory Palace:T4 解析 + T9 装入 + T11 编排。
- §11 digest-note:T11。
- §12 错误码:T2 定义 + T6/T7 使用。
- §14 权限:T1 `network` 声明(标注 schema 待对照)。
- §16 Phase 1 范围:完全对齐。

**2. 占位符扫描**:无 "TBD/TODO/实现 later"。`network` schema 与 `${PLUGIN_DIR}` 占位、`mcp.json` 形态是「对照 manifest-rules 确认」项,已显式标注(非代码占位)。

**3. 类型一致性**:`VaultService` 在 T6 定义、T8 实现、T9/T12 注入,签名一致;`RouterRequest/Response`、`ObsidianClient`、`RoomCard` 字段名跨 task 一致(`mustRead`/`outputLocation`/`pitfalls`);`BridgeError.code` 用 `ErrorCode`。

无修复项。

---

## 执行修正记录(2026-07-04 inline 执行,不碰 git)

实际 inline 执行 T1–T12 时对 plan 的修正:

1. **`permissions.network` schema**(T1):实际为 `{ "outbound": ["127.0.0.1:43112"] }`(对照 `scripts/lib/audit-permissions.mjs`),非 plan 原写的 `{ hosts }`。声明 `network.outbound` 触发审计,README `## 权限说明` 放行。
2. **LICENSE**(T1):`build-manifest.mjs` 硬要求每插件有 `LICENSE`,plan 漏写,已补(MIT)。
3. **`BridgeError` parameter property**(T7):Node 24 strip-only 不支持 `constructor(public code: ...)`,改为显式字段赋值,确保 `.ts` 测试在纯 Node 24 也能跑(根 `npm test` 兼容)。
4. **smoke token 流**(T12):plan 的 `getToken: () => pairing.consumeCode(code)` 会因一次性消耗返回 null → 401;改为 `/pair` 后保存 token 复用。
5. **mockFetch fallback**(T7):route 查找加 `routes[key] ?? routes[纯路径]` 兼容。
6. **main.ts 静态 import**(T9):用 `import { Plugin, PluginSettingTab } from "obsidian"` 替代顶层 `await import`,避免打包问题。

**验收**:
- 插件 `npm test`(tsx):**28/28 pass**。
- `dist/main.js`(14.9kb)+ `dist/mcp.js`(124kb)生成。
- `npm run check:index`:in sync。
- 根 `npm test`(Node 24):obsidian-bridge 全部通过;唯一失败是 lume-chrome 的 capability descriptor 测试(browserAuth,预存于 `codex/browser-parity-ux` 分支,与本项目无关)。
- **开放项**:`dist/mcp.js` 与 `dist/main.js` 的运行时冒烟需分别在 Lume(stdio)与 Obsidian(http)内人工验证。
