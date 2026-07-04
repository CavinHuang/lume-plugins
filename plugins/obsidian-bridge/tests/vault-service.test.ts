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
      getAbstractFileByPath: (p: string) => (store.has(p) ? { path: p } : null),
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
      getMarkdownFiles: () => [...store.keys()].map((p) => ({ path: p })),
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
