import { test } from "node:test";
import assert from "node:assert/strict";
import { createVaultService } from "../src/obsidian-app/vault-service.ts";
import { mergeFrontmatterLink } from "../src/mcp/tools.ts";

function mockApp(
  files: Record<
    string,
    {
      content?: string;
      mtime?: number;
      frontmatter?: Record<string, unknown>;
      tags?: string[];
    }
  >,
  opts: {
    resolvedLinks?: Record<string, Record<string, number>>;
    unresolvedLinks?: Record<string, string[]>;
  } = {},
) {
  const store = new Map(
    Object.entries(files).map(([k, v]) => [
      k,
      {
        content: v.content ?? "",
        mtime: v.mtime ?? 1000,
        ctime: 500,
        frontmatter: v.frontmatter ?? {},
        tags: v.tags ?? [],
      },
    ]),
  );
  return {
    vault: {
      getAbstractFileByPath: (p: string) =>
        store.has(p) ? { path: p, stat: { mtime: store.get(p)!.mtime!, ctime: store.get(p)!.ctime } } : null,
      read: async (f: { path: string }) => store.get(f.path)!.content,
      create: async (p: string, c: string) => {
        store.set(p, { content: c, mtime: 2000, ctime: 2000, frontmatter: {}, tags: [] });
        return { path: p };
      },
      modify: async (f: { path: string }, c: string) => {
        const e = store.get(f.path)!;
        e.content = c;
        e.mtime = 3000;
      },
      delete: async (f: { path: string }) => {
        store.delete(f.path);
      },
      getMarkdownFiles: () =>
        [...store.keys()].map((p) => ({
          path: p,
          stat: { mtime: store.get(p)!.mtime!, ctime: store.get(p)!.ctime },
        })),
    },
    metadataCache: {
      getFileCache: (f: { path: string }) => ({
        frontmatter: store.get(f.path)?.frontmatter,
        tags: store.get(f.path)?.tags
          ? Object.fromEntries(store.get(f.path)!.tags!.map((t) => [t, 1]))
          : null,
      }),
      resolvedLinks: opts.resolvedLinks ?? {},
      unresolvedLinks: opts.unresolvedLinks ?? {},
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
  const app = mockApp({ "a.md": { content: "x", tags: ["t1"], frontmatter: { k: "v" } } });
  const s = createVaultService(app);
  const m = await s.metadata("a.md");
  assert.deepEqual(m.tags, ["t1"]);
  assert.equal((m.frontmatter as { k: string }).k, "v");
});

test("listNotes filters by prefix", async () => {
  const app = mockApp({
    "memory/inbox/a.md": { content: "x" },
    "memory/inbox/b.md": { content: "y" },
    "people/z.md": { content: "z" },
  });
  const s = createVaultService(app);
  const paths = await s.listNotes("memory/inbox/");
  assert.deepEqual(paths.sort(), ["memory/inbox/a.md", "memory/inbox/b.md"]);
});

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
    {
      "raw/x.pdf.md": { content: "x" },
      "note.md": { content: "[[bad]]" },
      "lonely.md": { content: "l" },
    },
    { resolvedLinks: { "note.md": {} }, unresolvedLinks: { "note.md": ["bad"] } },
  );
  const s = createVaultService(app);
  const d = await s.diagnostics();
  assert.deepEqual(d.brokenLinks, [{ from: "note.md", link: "bad" }]);
  assert.ok(d.orphans.includes("lonely.md"));
  assert.ok(d.rawUndigested.includes("raw/x.pdf.md"));
});

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
  assert.equal(m.mtime, 0);
  assert.equal(m.ctime, 0);
});

test("read 不存在文件抛错而非裸 NPE", async () => {
  const app = mockApp({});
  const s = createVaultService(app);
  await assert.rejects(() => s.read("missing.md"), /not found/);
});

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

test("graphNeighbors both 方向 N 跳", async () => {
  const app = mockApp(
    { "a.md": {}, "b.md": {}, "c.md": {} },
    { resolvedLinks: { "a.md": { "b.md": 1 }, "b.md": { "c.md": 1 } } },
  );
  const s = createVaultService(app);
  const ns = s.graphNeighbors("a.md", 2, "both").map((n) => n.path).sort();
  assert.deepEqual(ns, ["b.md", "c.md"]);
});

test("graphPath 返回最短路径", async () => {
  const app = mockApp(
    { "a.md": {}, "b.md": {}, "c.md": {} },
    { resolvedLinks: { "a.md": { "b.md": 1 }, "b.md": { "c.md": 1 } } },
  );
  const s = createVaultService(app);
  assert.deepEqual(s.graphPath("a.md", "c.md"), ["a.md", "b.md", "c.md"]);
});

test("buildAdjacencies 合并 frontmatter.links 类型化边", () => {
  const app = mockApp(
    {
      "p.md": { content: "x", frontmatter: { links: [{ to: "people/z.md", type: "owner" }] } },
      "people/z.md": { content: "z" },
    },
  );
  const s = createVaultService(app);
  const adj = s.buildAdjacencies();
  assert.ok(adj.fwd.get("p.md")!.has("people/z.md")); // frontmatter.links 进入出边
  assert.ok(adj.both.get("people/z.md")!.has("p.md")); // 双向
  // 方向语义:类型化边只进 fwd/both,不进 back(wiki-link 入边专管 back)
  assert.ok(!adj.back.get("people/z.md")!.has("p.md"));
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

// 最小 frontmatter 解析:仅提取 buildAdjacencies 读取契约所要求的 links[].to(+ 可选 type)。
// 充当 Obsidian metadataCache「YAML→对象」步骤的 stand-in,把 mergeFrontmatterLink 写出的
// 文本 frontmatter 还原为 buildAdjacencies 读取的对象形。若两端 schema 漂移,此处解析结果
// 将与读侧预期不符,下列端到端断言随即失败。
function parseLinksFromFrontmatter(body: string): Array<{ to: string; type?: string }> {
  const m = body.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return [];
  const fm = m[1]!;
  const linksMatch = fm.match(/^links:\n((?:[ \t]+.*\n?)+)/m);
  if (!linksMatch) return [];
  const links: Array<{ to: string; type?: string }> = [];
  let cur: { to?: string; type?: string } | null = null;
  for (const line of linksMatch[1]!.split("\n")) {
    if (!line.trim()) continue;
    if (/^[ \t]+-/.test(line)) {
      if (cur?.to) links.push(cur as { to: string; type?: string });
      cur = {};
    }
    const toM = line.match(/to:\s*(\S.*)$/);
    const typeM = line.match(/^[ \t]+type:\s*(\S.*)$/);
    if (toM && cur) cur.to = toM[1]!.trim();
    else if (typeM && cur) cur.type = typeM[1]!.trim();
  }
  if (cur?.to) links.push(cur as { to: string; type?: string });
  return links;
}

// 端到端 schema 对称性(Spec P3 DoD):link_notes 写半 mergeFrontmatterLink 产出的
// YAML frontmatter,经解析后喂回读半 buildAdjacencies,类型化边必须在 fwd/both 出现且不进 back。
// 锁定读写两端共享同一个 links:[{to,type}] schema。
test("link_notes 写入的 frontmatter.links 被 graph 邻接表识别(端到端 schema 对称)", () => {
  const fromBody = "# from note\n";
  // 用写半工具产出真实 YAML frontmatter(模拟 link_notes 在 from 笔记上落库)
  const written = mergeFrontmatterLink(fromBody, { to: "people/z.md", type: "owner" });
  // 解析回对象(模拟 Obsidian metadataCache 下一次读取)
  const parsedLinks = parseLinksFromFrontmatter(written);
  assert.equal(parsedLinks.length, 1, "应解析出 1 条 links 边");
  assert.equal(parsedLinks[0]!.to, "people/z.md");
  assert.equal(parsedLinks[0]!.type, "owner");

  const app = mockApp(
    {
      "from.md": { content: written, frontmatter: { links: parsedLinks } },
      "people/z.md": { content: "z" },
    },
    { resolvedLinks: {} },
  );
  const s = createVaultService(app);
  const adj = s.buildAdjacencies();
  assert.ok(adj.fwd.get("from.md")!.has("people/z.md"), "写半产出的 to 应进入 fwd 出边");
  assert.ok(adj.both.get("from.md")!.has("people/z.md"), "写半产出的 to 应进入 both");
  assert.ok(adj.both.get("people/z.md")!.has("from.md"), "反向 also 双向");
  assert.ok(!adj.back.get("people/z.md")!.has("from.md"), "类型化边不进 back");
});
