import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter, type VaultService } from "../src/obsidian-app/http-router.ts";
import { createPairingStore } from "../src/obsidian-app/pairing-store.ts";
import { ERROR_CODES } from "../src/shared/protocol.ts";

function mockVault(over: Partial<VaultService> = {}): VaultService {
  return {
    async read() {
      return "# note";
    },
    async exists() {
      return true;
    },
    async write() {},
    async patch() {},
    async delete() {},
    async search() {
      return [];
    },
    async metadata() {
      return { tags: [], frontmatter: {}, mtime: 0, ctime: 0 };
    },
    async backlinks() {
      return [];
    },
    async listNotes() {
      return [];
    },
    async diagnostics() {
      return { brokenLinks: [], orphans: [], rawUndigested: [] };
    },
    // 图谱方法默认空实现(各 graph_* 路由测试通过 over 覆盖)。补齐以满足 VaultService 契约。
    buildAdjacencies() {
      return { fwd: new Map(), back: new Map(), both: new Map() };
    },
    graphNeighbors() {
      return [];
    },
    graphPath() {
      return [];
    },
    graphStructure() {
      return { hubs: [], orphans: [], bridges: [] };
    },
    graphSimilar() {
      return [];
    },
    ...over,
  };
}

const base = {
  pairing: createPairingStore({ ttlMs: 600000, now: () => 1000, random: () => "112233" }),
  vaultName: "TestVault",
  appVersion: "0.0.0-test",
  getRoomMarkdown: async () => "## 触发场景\nx\n",
};

function freshToken(): string {
  base.pairing.generateCode();
  return base.pairing.consumeCode("112233")!;
}

test("/health 无需鉴权,返回 vaultName 与协议版本", async () => {
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({ method: "GET", path: "/health", headers: {}, body: "" });
  assert.equal(res.status, 200);
  assert.equal((res.body as { ok: boolean }).ok, true);
  assert.equal((res.body as { vaultName: string }).vaultName, "TestVault");
  assert.equal((res.body as { protocol: number }).protocol, 1);
});

test("受保护端点无 token 返回 401", async () => {
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({
    method: "GET",
    path: "/notes",
    headers: {},
    body: "",
    query: { path: "a.md" },
  });
  assert.equal(res.status, 401);
  assert.equal((res.body as ApiErr).error.code, ERROR_CODES.token_invalid);
});

test("POST /notes 到 raw/ 返回 403 raw_readonly", async () => {
  const token = freshToken();
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({
    method: "POST",
    path: "/notes",
    headers: { authorization: `Bearer ${token}` },
    body: { path: "raw/x.md", content: "x" },
  });
  assert.equal(res.status, 403);
  assert.equal((res.body as ApiErr).error.code, ERROR_CODES.raw_readonly);
});

test("POST /notes 到 people/ 无 X-Confirmed 返回 409 needs_confirmation", async () => {
  const token = freshToken();
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({
    method: "POST",
    path: "/notes",
    headers: { authorization: `Bearer ${token}` },
    body: { path: "people/zhang.md", content: "x" },
  });
  assert.equal(res.status, 409);
  assert.equal((res.body as ApiErr).error.code, ERROR_CODES.needs_confirmation);
});

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

test("协议版本不匹配返回 426", async () => {
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({
    method: "GET",
    path: "/notes",
    headers: { "x-protocol-version": "999" },
    body: "",
    query: { path: "a.md" },
  });
  assert.equal(res.status, 426);
});

test("GET /notes?list= 返回路径列表", async () => {
  const token = freshToken();
  const r = createRouter({
    ...base,
    vault: mockVault({
      async listNotes(_p: string) {
        return ["memory/inbox/a.md"];
      },
    } as Partial<VaultService>),
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

test("GET /diagnostics 返回体检数据", async () => {
  const token = freshToken();
  const r = createRouter({
    ...base,
    vault: mockVault({
      async diagnostics() {
        return {
          brokenLinks: [{ from: "n.md", link: "bad" }],
          orphans: ["l.md"],
          rawUndigested: [],
        };
      },
    } as Partial<VaultService>),
  });
  const res = await r({
    method: "GET",
    path: "/diagnostics",
    headers: { authorization: `Bearer ${token}` },
    body: "",
  });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { brokenLinks: unknown[] }).brokenLinks, [
    { from: "n.md", link: "bad" },
  ]);
});

test("/health 的 appVersion 来自注入而非写死", async () => {
  const r = createRouter({ ...base, vault: mockVault(), appVersion: "9.9.9" } as any);
  const res = await r({ method: "GET", path: "/health", headers: {}, body: "" });
  assert.equal((res.body as { appVersion: string }).appVersion, "9.9.9");
});

test("GET /graph/neighbors 返回 N 跳邻居", async () => {
  const token = freshToken();
  const r = createRouter({
    ...base,
    appVersion: "0",
    vault: mockVault({
      graphNeighbors() {
        return [{ path: "b.md", depth: 1, via: "a.md" }];
      },
    } as Partial<VaultService>),
  });
  const res = await r({
    method: "GET",
    path: "/graph/neighbors",
    headers: { authorization: `Bearer ${token}` },
    body: "",
    query: { path: "a.md", depth: "1", direction: "both" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { nodes: { path: string }[] }).nodes[0].path, "b.md");
});

test("GET /graph/path 返回最短路径", async () => {
  const token = freshToken();
  const r = createRouter({
    ...base,
    appVersion: "0",
    vault: mockVault({
      graphPath() {
        return ["a.md", "b.md", "c.md"];
      },
    } as Partial<VaultService>),
  });
  const res = await r({
    method: "GET",
    path: "/graph/path",
    headers: { authorization: `Bearer ${token}` },
    body: "",
    query: { from: "a.md", to: "c.md" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { path: string[] }).path, ["a.md", "b.md", "c.md"]);
});

test("GET /graph/neighbors 将 depth 钳制到 1..3 并规范化 direction", async () => {
  const token = freshToken();
  const calls: { depth: number; direction: string }[] = [];
  const r = createRouter({
    ...base,
    appVersion: "0",
    vault: mockVault({
      graphNeighbors(_p, depth, direction) {
        calls.push({ depth, direction });
        return [];
      },
    } as Partial<VaultService>),
  });
  // depth=99 钳到 3,direction=invalid 规范化为 both
  await r({
    method: "GET",
    path: "/graph/neighbors",
    headers: { authorization: `Bearer ${token}` },
    body: "",
    query: { path: "a.md", depth: "99", direction: "sideways" },
  });
  assert.deepEqual(calls[0], { depth: 3, direction: "both" });
});

test("GET /graph/structure 返回 hub/孤岛/桥", async () => {
  const token = freshToken();
  const r = createRouter({
    ...base,
    appVersion: "0",
    vault: mockVault({
      graphStructure() {
        return {
          hubs: ["b.md"],
          orphans: ["l.md"],
          bridges: [{ from: "c.md", to: "d.md" }],
        };
      },
    } as Partial<VaultService>),
  });
  const res = await r({
    method: "GET",
    path: "/graph/structure",
    headers: { authorization: `Bearer ${token}` },
    body: "",
  });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as any).hubs, ["b.md"]);
  assert.deepEqual((res.body as any).bridges, [{ from: "c.md", to: "d.md" }]);
});

test("GET /graph/structure 将 top 钳制到 1..100(默认 10)", async () => {
  const token = freshToken();
  const calls: number[] = [];
  const r = createRouter({
    ...base,
    appVersion: "0",
    vault: mockVault({
      graphStructure(top?: number) {
        calls.push(top as number);
        return { hubs: [], orphans: [], bridges: [] };
      },
    } as Partial<VaultService>),
  });
  // 缺省 → 10
  await r({
    method: "GET",
    path: "/graph/structure",
    headers: { authorization: `Bearer ${token}` },
    body: "",
  });
  // top=9999 钳到 100
  await r({
    method: "GET",
    path: "/graph/structure",
    headers: { authorization: `Bearer ${token}` },
    body: "",
    query: { top: "9999" },
  });
  // top=-5 钳到 1
  await r({
    method: "GET",
    path: "/graph/structure",
    headers: { authorization: `Bearer ${token}` },
    body: "",
    query: { top: "-5" },
  });
  assert.deepEqual(calls, [10, 100, 1]);
});

test("GET /graph/similar 返回相似笔记", async () => {
  const token = freshToken();
  const r = createRouter({
    ...base,
    appVersion: "0",
    vault: mockVault({
      // VaultService.graphSimilar 是同步的(Task 11);mock 不能用 async
      graphSimilar() {
        return [{ path: "y.md", score: 0.5 }];
      },
    } as Partial<VaultService>),
  });
  const res = await r({
    method: "GET",
    path: "/graph/similar",
    headers: { authorization: `Bearer ${token}` },
    body: "",
    query: { path: "x.md", limit: "5" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(
    (res.body as { similar: { path: string; score: number }[] }).similar[0].path,
    "y.md",
  );
});

test("GET /graph/similar 将 limit 钳制到 1..50(默认 10)", async () => {
  const token = freshToken();
  const calls: number[] = [];
  const r = createRouter({
    ...base,
    appVersion: "0",
    vault: mockVault({
      graphSimilar(_p, limit?) {
        calls.push(limit as number);
        return [];
      },
    } as Partial<VaultService>),
  });
  // 缺省 → 10
  await r({
    method: "GET",
    path: "/graph/similar",
    headers: { authorization: `Bearer ${token}` },
    body: "",
    query: { path: "x.md" },
  });
  // limit=9999 钳到 50
  await r({
    method: "GET",
    path: "/graph/similar",
    headers: { authorization: `Bearer ${token}` },
    body: "",
    query: { path: "x.md", limit: "9999" },
  });
  // limit=0 钳到 1
  await r({
    method: "GET",
    path: "/graph/similar",
    headers: { authorization: `Bearer ${token}` },
    body: "",
    query: { path: "x.md", limit: "0" },
  });
  assert.deepEqual(calls, [10, 50, 1]);
});

interface ApiErr {
  error: { code: string; message: string };
}
