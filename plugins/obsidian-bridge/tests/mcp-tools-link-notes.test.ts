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
} {
  const reads: string[] = [];
  const writes: { path: string; content: string }[] = [];
  return {
    reads,
    writes,
    health: async () => ({ ok: true, protocol: 1, appVersion: "1.7.0", vaultName: "Vault" }),
    pair: async () => ({ token: "T", vaultName: "Vault" }),
    readNote: async function (path: string) {
      reads.push(path);
      return { path, content: this._nextContent ?? "" };
    } as ObsidianClient["readNote"],
    upsertNote: async function (path: string, content: string) {
      writes.push({ path, content });
    } as ObsidianClient["upsertNote"],
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
    _nextContent: "",
  } as unknown as ObsidianClient & {
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
