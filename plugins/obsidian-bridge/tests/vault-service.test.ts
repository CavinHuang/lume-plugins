import { test } from "node:test";
import assert from "node:assert/strict";
import { createVaultService } from "../src/obsidian-app/vault-service.ts";

function mockApp(
  files: Record<
    string,
    {
      content: string;
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
        content: v.content,
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
