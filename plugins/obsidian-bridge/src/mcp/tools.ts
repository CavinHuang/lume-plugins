import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import type { ObsidianClient } from "./obsidian-client.ts";

export function registerTools(server: McpServer, client: ObsidianClient): void {
  server.tool(
    "read_note",
    "Read a note's content by vault path",
    { path: z.string() },
    async ({ path }) => {
      const r = await client.readNote(path);
      return { content: [{ type: "text" as const, text: r.content }] };
    },
  );

  server.tool(
    "search_notes",
    "Search vault by keyword (full-text)",
    { query: z.string(), limit: z.number().optional() },
    async ({ query, limit }) => {
      const hits = await client.search(query, { limit });
      return { content: [{ type: "text" as const, text: JSON.stringify(hits) }] };
    },
  );

  server.tool(
    "upsert_note",
    "Create or overwrite a note. For long-term memory zones (people/projects/wiki/...) set confirmed=true after user approval.",
    { path: z.string(), content: z.string(), confirmed: z.boolean().optional() },
    async ({ path, content, confirmed }) => {
      await client.upsertNote(path, content, { confirmed });
      return { content: [{ type: "text" as const, text: `written: ${path}` }] };
    },
  );

  server.tool(
    "delete_note",
    "Delete a note by path",
    { path: z.string() },
    async ({ path }) => {
      await client.deleteNote(path);
      return { content: [{ type: "text" as const, text: `deleted: ${path}` }] };
    },
  );

  server.tool(
    "get_metadata",
    "Get tags/frontmatter of a note",
    { path: z.string() },
    async ({ path }) => {
      const m = await client.metadata(path);
      return { content: [{ type: "text" as const, text: JSON.stringify(m) }] };
    },
  );

  server.tool(
    "backlinks",
    "List backlinks of a note",
    { path: z.string() },
    async ({ path }) => {
      const b = await client.backlinks(path);
      return { content: [{ type: "text" as const, text: JSON.stringify(b) }] };
    },
  );

  server.tool(
    "read_palace",
    "Read a Memory Palace room card (trigger/mustRead/conditionalRead/outputLocation/pitfalls)",
    { room: z.string() },
    async ({ room }) => {
      const c = await client.readPalace(room);
      return { content: [{ type: "text" as const, text: JSON.stringify(c) }] };
    },
  );

  server.tool(
    "list_notes",
    "List note paths under a vault prefix (e.g. 'memory/inbox/')",
    { prefix: z.string() },
    async ({ prefix }) => {
      const paths = await client.listNotes(prefix);
      return { content: [{ type: "text" as const, text: JSON.stringify(paths) }] };
    },
  );

  server.tool(
    "vault_diagnostics",
    "Vault health: broken links, orphans (no links), and raw/ files not yet digested",
    {},
    async () => {
      const d = await client.diagnostics();
      return { content: [{ type: "text" as const, text: JSON.stringify(d) }] };
    },
  );
}
