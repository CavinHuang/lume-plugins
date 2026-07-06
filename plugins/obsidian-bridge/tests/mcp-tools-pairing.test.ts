import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../src/mcp/tools.ts";
import type { ObsidianClient } from "../src/mcp/obsidian-client.ts";
import type { TokenStore } from "../src/mcp/token-store.ts";

type ToolHandler = (input: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

class FakeServer {
  tools = new Map<string, ToolHandler>();

  tool(name: string, _description: string, _schema: unknown, handler: ToolHandler): void {
    this.tools.set(name, handler);
  }
}

function makeClient(): ObsidianClient {
  return {
    health: async () => ({ ok: true, protocol: 1, appVersion: "1.7.0", vaultName: "Vault" }),
    pair: async () => ({ token: "SECRET_TOKEN", vaultName: "Vault" }),
    readNote: async () => ({ path: "a.md", content: "hi" }),
    upsertNote: async () => {},
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
  };
}

function makeTokenStore(): TokenStore & { saved: string | null } {
  return {
    saved: null,
    read: async function () {
      return this.saved;
    },
    write: async function (token: string) {
      this.saved = token;
    },
    clear: async function () {
      this.saved = null;
    },
  };
}

test("pairing tools register status, pair, and forget without leaking token", async () => {
  const server = new FakeServer();
  const tokenStore = makeTokenStore();
  registerTools(server as unknown as McpServer, makeClient(), { tokenStore });

  assert.ok(server.tools.has("bridge_status"));
  assert.ok(server.tools.has("pair_with_code"));
  assert.ok(server.tools.has("forget_pairing"));

  const statusBefore = await server.tools.get("bridge_status")!({});
  assert.match(statusBefore.content[0]!.text, /"paired":false/);

  const paired = await server.tools.get("pair_with_code")!({ code: "123456" });
  assert.equal(tokenStore.saved, "SECRET_TOKEN");
  assert.match(paired.content[0]!.text, /"paired":true/);
  assert.doesNotMatch(paired.content[0]!.text, /SECRET_TOKEN/);

  const statusAfter = await server.tools.get("bridge_status")!({});
  assert.match(statusAfter.content[0]!.text, /"paired":true/);
  assert.doesNotMatch(statusAfter.content[0]!.text, /SECRET_TOKEN/);

  await server.tools.get("forget_pairing")!({});
  assert.equal(tokenStore.saved, null);
});
