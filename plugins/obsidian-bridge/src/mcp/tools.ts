import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { ERROR_CODES } from "../shared/protocol.ts";
import { BridgeError, type ObsidianClient } from "./obsidian-client.ts";
import { createFileTokenStore, type TokenStore } from "./token-store.ts";

/**
 * 在 from 笔记正文里合并一条 frontmatter.links 边。
 *
 * 假设 schema:`links: [{ to: <path>, type: <string> }, ...]`。
 * - 无 frontmatter 则前插一个;有 frontmatter 但无 `links:` 则在 fm 顶部新增。
 * - 有 `links:` 块时,委托给 {@link mergeLinksBlock} 合并——该函数对未知 schema 采取
 *   **保守 fallback**(逐字保留既有内容,只在末尾追加新边),避免损毁 user vault 里
 *   由其它工具(Dataview/Juggl 等)写入的 links 块。
 *
 * 导出供工具与测试复用。
 */
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

/**
 * 解析 frontmatter `links:` 块,合并一条 `{to, type}` 边,序列化回 YAML 文本。
 *
 * 假设 schema:`links: [{ to: <path>, type: <string> }, ...]`——每个列表项只含 `to` 与
 * 可选的 `type` 两个字段。
 *
 * Conservative fallback:若检测到既有块里存在任何不符合该 schema 的内容(例如带
 * `weight`/`from`/`note` 等额外字段的多字段项,或首字段不是 `to:` 的列表项),则
 * **绝不**修改或丢弃既有行——逐字保留原块,只在末尾追加新的 `{to, type}` 项。这防止
 * user vault 里由其它工具(Dataview/Juggl 等)写入的 links 块被静默损毁;此 fallback
 * 路径下 dedup-by-`to` 被跳过(安全 > 去重)。
 *
 * Happy path(所有项都是干净的 `{to, type}` 对):按 `to` 去重——同 `to` 覆盖 `type`,
 * 否则追加。
 */
function mergeLinksBlock(block: string, edge: { to: string; type: string }): string {
  const lines = block.split("\n");
  const headerLine = lines[0] ?? "links:";
  const items: string[][] = [];
  const trailing: string[] = [];
  let currentItem: string[] | null = null;

  // 逐行切分:header / 列表项(以 `^[ \t]+-` 开头)/ 项内续行 / 块尾随内容。
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i]!;
    if (ln === "" || !/^[ \t]/.test(ln)) {
      // 空行或非缩进行:items 区结束,余下全部作为 trailing 保留(绝不丢)。
      if (currentItem) { items.push(currentItem); currentItem = null; }
      for (; i < lines.length; i++) trailing.push(lines[i]!);
      break;
    }
    if (/^[ \t]+-/.test(ln)) {
      if (currentItem) items.push(currentItem);
      currentItem = [ln];
    } else if (currentItem) {
      currentItem.push(ln);
    } else {
      trailing.push(ln);
    }
  }
  if (currentItem) items.push(currentItem);

  // 严格 schema:每个 item 必须恰好是 `  - to: <val>` 可选后跟一行 `    type: <val>`。
  const isStrict = (item: string[]): boolean => {
    if (item.length === 0 || item.length > 2) return false;
    if (!/^[ \t]+-+\s*to:\s*\S/.test(item[0]!)) return false;
    if (item.length === 2) return /^[ \t]+type:\s*\S/.test(item[1]!);
    return true;
  };
  const allStrict = items.every(isStrict);

  if (!allStrict) {
    // 保守 fallback:既有 items/trailing 逐字保留,末尾追加新边,绝不丢一行。
    let out = headerLine;
    for (const item of items) {
      for (const ln of item) out += "\n" + ln;
    }
    out += `\n  - to: ${edge.to}\n    type: ${edge.type}`;
    if (trailing.length > 0) out += "\n" + trailing.join("\n");
    return out + "\n";
  }

  // Happy path:解析为 entries,按 to 去重合并。
  const entries: { to: string; type: string }[] = items.map((item) => {
    const m = item[0]!.match(/^[ \t]+-+\s*to:\s*(\S.*)$/)!;
    const to = m[1]!.trim();
    let type = "";
    if (item.length === 2) {
      const tm = item[1]!.match(/^[ \t]+type:\s*(\S.*)$/);
      if (tm) type = tm[1]!.trim();
    }
    return { to, type };
  });
  const idx = entries.findIndex((e) => e.to === edge.to);
  if (idx >= 0) entries[idx]!.type = edge.type;
  else entries.push({ to: edge.to, type: edge.type });

  let out = headerLine;
  for (const e of entries) {
    out += `\n  - to: ${e.to}\n    type: ${e.type}`;
  }
  if (trailing.length > 0) out += "\n" + trailing.join("\n");
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
