import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { ERROR_CODES } from "../shared/protocol.ts";
import { BridgeError, type ObsidianClient } from "./obsidian-client.ts";
import { createFileTokenStore, type TokenStore } from "./token-store.ts";

// 在 from 笔记正文里合并一条 frontmatter.links 边。极简健壮实现:
// - 有 frontmatter 则在 links 数组追加(按 to 去重,已存在同 to 的边则覆盖 type);
// - 无 frontmatter 则前插一个。
// 导出供工具与测试复用。
export function mergeFrontmatterLink(body: string, edge: { to: string; type: string }): string {
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) {
    return `---\nlinks:\n  - to: ${edge.to}\n    type: ${edge.type}\n---\n${body}`;
  }
  const fm = fmMatch[1];
  // 已有 links: 则解析-合并-序列化,避免文本注入破坏缩进/重复 to。
  if (/^links:/m.test(fm)) {
    const updated = fm.replace(
      /^(links:\n(?:[ \t]+.*\n?)+)/m,
      (block: string) => mergeLinksBlock(block, edge),
    );
    return body.replace(fmMatch[0], `---\n${updated}\n---\n`);
  }
  // 无 links: 在 frontmatter 顶部新增
  const newFm = `links:\n  - to: ${edge.to}\n    type: ${edge.type}\n` + fm;
  return body.replace(fmMatch[0], `---\n${newFm}\n---\n`);
}

// 解析 links: 块,合并 edge(by to 去重),再序列化回 YAML 文本。
function mergeLinksBlock(block: string, edge: { to: string; type: string }): string {
  const lines = block.split("\n");
  const entries: { to: string; type: string }[] = [];
  let header = "links:";
  let trailing = "";
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    if (ln === "links:") {
      header = ln;
      continue;
    }
    const m = ln.match(/^[ \t]+-+\s*to:\s*(\S.*)$/);
    if (m) {
      const to = m[1]!.trim();
      // 找紧随的 type 行
      const next = lines[i + 1] ?? "";
      const tm = next.match(/^[ \t]+type:\s*(\S.*)$/);
      entries.push({ to, type: tm ? tm[1]!.trim() : "" });
      if (tm) i++;
    } else if (ln !== "" && !/^[ \t]+-/.test(ln) && !/^[ \t]+(to|type):/.test(ln)) {
      // 非_links 数组项的尾随内容(其它 frontmatter 字段)——保留
      trailing += (trailing ? "\n" : "") + ln;
    }
  }
  // 合并:同 to 覆盖 type,否则追加
  const idx = entries.findIndex((e) => e.to === edge.to);
  if (idx >= 0) entries[idx]!.type = edge.type;
  else entries.push({ to: edge.to, type: edge.type });
  let out = header;
  for (const e of entries) {
    out += `\n  - to: ${e.to}\n    type: ${e.type}`;
  }
  if (trailing) out += "\n" + trailing;
  return out + "\n";
}

export function registerTools(
  server: McpServer,
  client: ObsidianClient,
  options: { tokenStore?: TokenStore } = {},
): void {
  const tokenStore = options.tokenStore ?? createFileTokenStore();

  server.tool(
    "bridge_status",
    "Check local Obsidian bridge reachability and pairing status without exposing the token",
    {},
    async () => toolText(async () => {
      const health = await client.health();
      const paired = Boolean(process.env.OBSIDIAN_BRIDGE_TOKEN || await tokenStore.read());
      return JSON.stringify({
        reachable: true,
        ok: health.ok,
        protocol: health.protocol,
        appVersion: health.appVersion,
        vaultName: health.vaultName,
        paired,
        pairingRequired: !paired,
      });
    }),
  );

  server.tool(
    "pair_with_code",
    "Pair Lume with Obsidian using the code shown in the Obsidian Bridge settings page",
    { code: z.string().min(1) },
    async ({ code }) => toolText(async () => {
      const paired = await client.pair(code.trim());
      await tokenStore.write(paired.token);
      return JSON.stringify({ paired: true, vaultName: paired.vaultName });
    }),
  );

  server.tool(
    "forget_pairing",
    "Forget the locally stored Obsidian pairing token",
    {},
    async () => toolText(async () => {
      await tokenStore.clear();
      return JSON.stringify({ paired: false });
    }),
  );

  server.tool(
    "read_note",
    "Read a note's content by vault path",
    { path: z.string() },
    async ({ path }) => toolText(async () => {
      const r = await client.readNote(path);
      return r.content;
    }),
  );

  server.tool(
    "search_notes",
    "Search vault by keyword (full-text)",
    { query: z.string(), limit: z.number().optional() },
    async ({ query, limit }) => toolText(async () => {
      const hits = await client.search(query, { limit });
      return JSON.stringify(hits);
    }),
  );

  server.tool(
    "upsert_note",
    "Create or overwrite a note. For long-term memory zones (people/projects/wiki/...) set confirmed=true after user approval.",
    { path: z.string(), content: z.string(), confirmed: z.boolean().optional() },
    async ({ path, content, confirmed }) => toolText(async () => {
      await client.upsertNote(path, content, { confirmed });
      return `written: ${path}`;
    }),
  );

  server.tool(
    "delete_note",
    "Delete a note by path",
    { path: z.string() },
    async ({ path }) => toolText(async () => {
      await client.deleteNote(path);
      return `deleted: ${path}`;
    }),
  );

  server.tool(
    "get_metadata",
    "Get tags/frontmatter of a note",
    { path: z.string() },
    async ({ path }) => toolText(async () => {
      const m = await client.metadata(path);
      return JSON.stringify(m);
    }),
  );

  server.tool(
    "backlinks",
    "List backlinks of a note",
    { path: z.string() },
    async ({ path }) => toolText(async () => {
      const b = await client.backlinks(path);
      return JSON.stringify(b);
    }),
  );

  server.tool(
    "read_palace",
    "Read a Memory Palace room card (trigger/mustRead/conditionalRead/outputLocation/pitfalls)",
    { room: z.string() },
    async ({ room }) => toolText(async () => {
      const c = await client.readPalace(room);
      return JSON.stringify(c);
    }),
  );

  server.tool(
    "list_notes",
    "List note paths under a vault prefix (e.g. 'memory/inbox/')",
    { prefix: z.string() },
    async ({ prefix }) => toolText(async () => {
      const paths = await client.listNotes(prefix);
      return JSON.stringify(paths);
    }),
  );

  server.tool(
    "vault_diagnostics",
    "Vault health: broken links, orphans (no links), and raw/ files not yet digested",
    {},
    async () => toolText(async () => {
      const d = await client.diagnostics();
      return JSON.stringify(d);
    }),
  );

  server.tool(
    "graph_neighbors",
    "List notes within N hops (default 1, max 3) of a note, via wiki-link graph. direction: fwd (outgoing) | back (incoming) | both.",
    {
      path: z.string(),
      depth: z.number().optional(),
      direction: z.enum(["fwd", "back", "both"]).optional(),
    },
    async ({ path, depth, direction }) =>
      toolText(async () => {
        const nodes = await client.graphNeighbors(path, depth ?? 1, direction ?? "both");
        return JSON.stringify(nodes);
      }),
  );

  server.tool(
    "graph_path",
    "Find the shortest wiki-link path between two notes. Returns {path:[...], hops:n}; empty path if unreachable.",
    { from: z.string(), to: z.string() },
    async ({ from, to }) =>
      toolText(async () => {
        const r = await client.graphPath(from, to);
        return JSON.stringify(r);
      }),
  );

  server.tool(
    "graph_structure",
    "Vault graph structure: hub notes (most connections), orphans (no links), bridges (edges whose removal splits the graph).",
    { top: z.number().optional() },
    async ({ top }) =>
      toolText(async () => {
        const r = await client.graphStructure(top);
        return JSON.stringify(r);
      }),
  );

  server.tool(
    "graph_similar",
    "Find notes similar to a given one by shared neighbors (Jaccard over the wiki-link graph). Returns [{path, score}].",
    { path: z.string(), limit: z.number().optional() },
    async ({ path, limit }) =>
      toolText(async () => JSON.stringify(await client.graphSimilar(path, limit))),
  );

  server.tool(
    "link_notes",
    "Create a link from one note to another. If type is omitted, appends a [[to]] wiki link to the body; if type is given, records a typed edge in the from-note's frontmatter links:[{to,type}]. Writing to protected zones (people/, projects/, wiki/, ...) requires confirmed=true.",
    {
      from: z.string(),
      to: z.string(),
      type: z.string().optional(),
      confirmed: z.boolean().optional(),
    },
    async ({ from, to, type, confirmed }) =>
      toolText(async () => {
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
        await client.upsertNote(
          from,
          `${r.content}${sep}\n[[${to.replace(/\.md$/, "")}]]\n`,
          { confirmed },
        );
        return `wiki link: ${from} -> ${to}`;
      }),
  );
}

async function toolText(run: () => Promise<string>): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    return { content: [{ type: "text", text: await run() }] };
  } catch (error) {
    return { content: [{ type: "text", text: formatBridgeToolError(error) }] };
  }
}

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
