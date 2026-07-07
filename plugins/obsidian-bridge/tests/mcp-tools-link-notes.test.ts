import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools, mergeFrontmatterLink } from "../src/mcp/tools.ts";
import type { ObsidianClient } from "../src/mcp/obsidian-client.ts";

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
}>;

class FakeServer {
  tools = new Map<string, ToolHandler>();
  tool(name: string, _description: string, _schema: unknown, handler: ToolHandler): void {
    this.tools.set(name, handler);
  }
}

function makeClient(): ObsidianClient & {
  reads: string[];
  writes: { path: string; content: string }[];
  _nextContent: string;
} {
  const reads: string[] = [];
  const writes: { path: string; content: string }[] = [];
  const client = {
    reads,
    writes,
    _nextContent: "",
    health: async () => ({ ok: true, protocol: 1, appVersion: "1.7.0", vaultName: "Vault" }),
    pair: async () => ({ token: "T", vaultName: "Vault" }),
    readNote: async (path: string) => {
      reads.push(path);
      return { path, content: client._nextContent ?? "" };
    },
    upsertNote: async (path: string, content: string) => {
      writes.push({ path, content });
    },
    patchNote: async () => {},
    deleteNote: async () => {},
    search: async () => [],
    metadata: async () => ({ tags: [], frontmatter: {}, mtime: 1, ctime: 1 }),
    backlinks: async () => [],
    readPalace: async () => ({
      trigger: "t",
      mustRead: [],
      conditionalRead: [],
      outputLocation: "memory/inbox/x.md",
      pitfalls: [],
    }),
    listNotes: async () => [],
    diagnostics: async () => ({ brokenLinks: [], orphans: [], rawUndigested: [] }),
    graphNeighbors: async () => [],
    graphPath: async () => ({ path: [], hops: 0 }),
    graphStructure: async () => ({ hubs: [], orphans: [], bridges: [] }),
    graphSimilar: async () => [],
  };
  return client as ObsidianClient & {
    reads: string[];
    writes: { path: string; content: string }[];
    _nextContent: string;
  };
}

test("link_notes 无 type:append [[to]] wiki link 到 from 正文", async () => {
  const server = new FakeServer();
  const client = makeClient();
  registerTools(server as unknown as McpServer, client);

  client._nextContent = "# A\nbody";
  const r = await server.tools.get("link_notes")!({
    from: "memory/a.md",
    to: "memory/b.md",
  });
  assert.match(r.content[0]!.text, /wiki link: memory\/a\.md -> memory\/b\.md/);
  assert.equal(client.writes.length, 1);
  assert.equal(client.writes[0]!.path, "memory/a.md");
  assert.match(client.writes[0]!.content, /\[\[memory\/b\]\]\n$/);
  // 去掉 .md 后缀
  assert.doesNotMatch(client.writes[0]!.content, /\[\[memory\/b\.md\]\]/);
});

test("link_notes 无 type 且正文不以换行结尾:补换行再 append", async () => {
  const server = new FakeServer();
  const client = makeClient();
  registerTools(server as unknown as McpServer, client);

  client._nextContent = "# A\nno trailing newline";
  await server.tools.get("link_notes")!({ from: "a.md", to: "b.md" });
  // 简报公式:${content}${sep}\n[[to]]\n —— 不以换行结尾时 sep="\n",故 wiki link 前有一空行
  assert.match(
    client.writes[0]!.content,
    /# A\nno trailing newline\n\n\[\[b\]\]\n$/,
  );
});

test("link_notes 有 type:走 mergeFrontmatterLink 并 upsert", async () => {
  const server = new FakeServer();
  const client = makeClient();
  registerTools(server as unknown as McpServer, client);

  client._nextContent = "---\ntitle: A\n---\n# A\n";
  const r = await server.tools.get("link_notes")!({
    from: "a.md",
    to: "b.md",
    type: "ref",
  });
  assert.match(r.content[0]!.text, /typed link: a\.md -\[ref\]-> b\.md/);
  assert.equal(client.writes.length, 1);
  // 写入的 content 应含 links: - to: b.md / type: ref
  assert.match(client.writes[0]!.content, /links:/);
  assert.match(client.writes[0]!.content, /to: b\.md/);
  assert.match(client.writes[0]!.content, /type: ref/);
  // 原 frontmatter title 应保留
  assert.match(client.writes[0]!.content, /title: A/);
  // 原正文应保留
  assert.match(client.writes[0]!.content, /# A/);
});

test("link_notes 工具注册:graph_similar + link_notes 都已注册", async () => {
  const server = new FakeServer();
  registerTools(server as unknown as McpServer, makeClient());
  assert.ok(server.tools.has("graph_similar"));
  assert.ok(server.tools.has("link_notes"));
});

// ===== mergeFrontmatterLink 边界用例 =====

test("mergeFrontmatterLink:无 frontmatter 时前插 links 块", () => {
  const out = mergeFrontmatterLink("# A\nbody", { to: "b.md", type: "ref" });
  assert.match(out, /^---\nlinks:\n  - to: b\.md\n    type: ref\n---\n# A/);
});

test("mergeFrontmatterLink:有 frontmatter 但无 links 时在 fm 内顶部新增 links", () => {
  const out = mergeFrontmatterLink("---\ntitle: A\n---\n# A\n", {
    to: "b.md",
    type: "ref",
  });
  assert.match(out, /^---\nlinks:\n  - to: b\.md\n    type: ref\ntitle: A\n---\n/);
  // 正文未丢
  assert.match(out, /# A/);
});

test("mergeFrontmatterLink:已有 links 时合并追加(by to 去重覆盖)", () => {
  const body = "---\nlinks:\n  - to: b.md\n    type: ref\ntitle: A\n---\n# A\n";
  const out = mergeFrontmatterLink(body, { to: "c.md", type: "see" });
  assert.match(out, /to: b\.md/);
  assert.match(out, /to: c\.md/);
  assert.match(out, /type: see/);
  // 原 frontmatter 其它字段保留
  assert.match(out, /title: A/);
  // 正文保留
  assert.match(out, /# A/);
});

test("mergeFrontmatterLink:同 to 已存在则覆盖 type(不重复)", () => {
  const body = "---\nlinks:\n  - to: b.md\n    type: old\n---\n# A\n";
  const out = mergeFrontmatterLink(body, { to: "b.md", type: "new" });
  // 只有一个 to: b.md 条目
  const matches = out.match(/to: b\.md/g) ?? [];
  assert.equal(matches.length, 1);
  assert.match(out, /type: new/);
  assert.doesNotMatch(out, /type: old/);
});

// ===== mergeFrontmatterLink 保守 fallback(防数据损毁)=====

test("mergeFrontmatterLink:links 块含非 schema 项(weight 字段)时保守 fallback,weight 不被错位", () => {
  // 既有 links 块来自其它工具,带 weight 字段(非我们写入的 {to,type} schema)。
  const body =
    "---\nlinks:\n  - to: a.md\n    type: ref\n    weight: 5\ntitle: A\n---\n# A\n";
  const out = mergeFrontmatterLink(body, { to: "b.md", type: "see" });
  // weight: 5 必须保留,且仍紧贴在 a.md 条目下(不得被错位到新边下)
  assert.match(out, /to: a\.md\n\s+type: ref\n\s+weight: 5/);
  // 新边被追加
  assert.match(out, /to: b\.md/);
  assert.match(out, /type: see/);
  // 原 frontmatter 其它字段保留
  assert.match(out, /title: A/);
  // 正文保留
  assert.match(out, /# A/);
});

test("mergeFrontmatterLink:links 块含 from:-prefixed 项时保守 fallback,既有项不丢", () => {
  // 非 to: 开头的列表项(Juggl 风格的 from/to)不应被丢弃。
  const body = "---\nlinks:\n  - from: x.md\n    to: y.md\n---\n# A\n";
  const out = mergeFrontmatterLink(body, { to: "z.md", type: "ref" });
  assert.match(out, /from: x\.md/);
  assert.match(out, /to: y\.md/);
  // 新边被追加(不去重,因 fallback 跳过 dedup)
  assert.match(out, /to: z\.md/);
  assert.match(out, /type: ref/);
});

// ===== mergeFrontmatterLink happy path:既有无类型条目不得漂移 =====

test("mergeFrontmatterLink:既有无类型条目(- to: a.md)在合并新边后逐字保留,不得被追加空 type:", () => {
  // 既有的无类型链接(length-1,无 type:)。旧序列化器总会写出 `    type: `,空值在
  // YAML 中解析为 null,把用户 `links:[{to:"a.md"}]` 静默升级为 `[{to:"a.md",type:null}]`。
  const body = "---\nlinks:\n  - to: a.md\ntitle: A\n---\n# A\n";
  const out = mergeFrontmatterLink(body, { to: "b.md", type: "ref" });
  // a.md 条目仍在,且其紧邻行不得出现 `type:`(即逐字保留 `- to: a.md`)。
  assert.match(out, /- to: a\.md\n/);
  assert.doesNotMatch(out, /- to: a\.md\n\s+type:/);
  // 新边正常携带 type: ref。
  assert.match(out, /- to: b\.md\n\s+type: ref/);
  // 原 frontmatter 其它字段保留
  assert.match(out, /title: A/);
  // 正文保留
  assert.match(out, /# A/);
});
