import type { VaultService } from "./http-router.ts";
import { neighbors, shortestPath, structure, type Adjacency } from "./graph-engine.ts";

// 最小 Obsidian 类型(避免强耦合 obsidian 包;真实 app 满足结构即可)
interface ObsidianApp {
  vault: {
    getAbstractFileByPath(p: string): { path: string; stat?: { mtime: number; ctime: number } } | null;
    read(f: { path: string }): Promise<string>;
    create(p: string, c: string): Promise<{ path: string }>;
    modify(f: { path: string }, c: string): Promise<void>;
    delete(f: { path: string }): Promise<void>;
    getMarkdownFiles(): { path: string; stat?: { mtime: number; ctime: number } }[];
  };
  metadataCache: {
    getFileCache(f: { path: string }): {
      frontmatter?: Record<string, unknown> | null;
      tags?: Record<string, number> | null;
    } | null;
    resolvedLinks: Record<string, Record<string, number>>;
    unresolvedLinks: Record<string, string[]>;
  };
}

export function createVaultService(app: ObsidianApp): VaultService {
  // 图谱适配层:基于 metadataCache.resolvedLinks 构建 fwd/back/both 三张邻接表。
  // 孤立节点也作为 key 保留(空 Set),供 Task 7 structure/orphans 使用。
  function buildAdjacencies(): { fwd: Adjacency; back: Adjacency; both: Adjacency } {
    const fwd: Adjacency = new Map();
    const back: Adjacency = new Map();
    const both: Adjacency = new Map();
    const ensure = (p: string) => {
      if (!fwd.has(p)) {
        fwd.set(p, new Set());
        back.set(p, new Set());
        both.set(p, new Set());
      }
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

  return {
    async read(path) {
      const f = app.vault.getAbstractFileByPath(path);
      if (!f) throw new Error(`not found: ${path}`);
      return app.vault.read(f);
    },
    async exists(path) {
      return app.vault.getAbstractFileByPath(path) !== null;
    },
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
        // 极简 frontmatter 合并:Phase 1 假设有 --- 头则改键,否则前插。
        content =
          "---\n" +
          Object.entries(frontmatter)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join("\n") +
          "\n---\n" +
          content;
      }
      await app.vault.modify(f, content);
    },
    async delete(path) {
      const f = app.vault.getAbstractFileByPath(path);
      if (f) await app.vault.delete(f);
    },
    async search(q, opts) {
      const limit = opts.limit ?? 50;
      const ql = q.toLowerCase();
      const hits: { path: string; snippet: string; score: number; mtime: number }[] = [];
      for (const f of app.vault.getMarkdownFiles()) {
        const mtime = f.stat?.mtime ?? 0;
        if (opts.type === "tag") {
          const cache = app.metadataCache.getFileCache(f);
          const tags = cache?.tags
            ? Object.keys(cache.tags).map((t) => t.replace(/^#/, "").toLowerCase())
            : [];
          if (tags.some((t) => t.includes(ql))) {
            hits.push({ path: f.path, snippet: `#${q}`, score: 1, mtime });
          }
        } else {
          const content = await app.vault.read(f);
          const idx = content.toLowerCase().indexOf(ql);
          if (idx >= 0) {
            const start = Math.max(0, idx - 30);
            hits.push({
              path: f.path,
              snippet: content.slice(start, idx + ql.length + 30),
              score: 1,
              mtime,
            });
          }
        }
        if (hits.length >= limit) break;
      }
      return hits;
    },
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
    },
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
    },
    async listNotes(prefix) {
      return app.vault
        .getMarkdownFiles()
        .filter((f) => f.path.startsWith(prefix))
        .map((f) => f.path);
    },
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
    buildAdjacencies,
    graphNeighbors(path, depth, direction) {
      const adj = buildAdjacencies();
      const map = direction === "fwd" ? adj.fwd : direction === "back" ? adj.back : adj.both;
      return neighbors(map, path, depth);
    },
    graphPath(from, to) {
      return shortestPath(buildAdjacencies().both, from, to);
    },
    graphStructure(top) {
      return structure(buildAdjacencies().both, top);
    },
  };
}
