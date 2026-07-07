import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { ERROR_CODES } from "../shared/protocol.ts";
import { BridgeError, type ObsidianClient } from "./obsidian-client.ts";
import { createFileTokenStore, type TokenStore } from "./token-store.ts";

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
