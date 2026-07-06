import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createObsidianClient } from "./obsidian-client.ts";
import { createFileTokenStore } from "./token-store.ts";
import { registerTools } from "./tools.ts";

const PORT = Number(process.env.OBSIDIAN_BRIDGE_PORT ?? 43112);
const baseUrl = `http://127.0.0.1:${PORT}`;
const tokenStore = createFileTokenStore();

const client = createObsidianClient({
  baseUrl,
  getToken: async () => process.env.OBSIDIAN_BRIDGE_TOKEN ?? await tokenStore.read(),
});

const server = new McpServer({ name: "obsidian-bridge", version: "0.1.1" });
registerTools(server, client, { tokenStore });

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch((e) => {
  console.error("[obsidian-bridge mcp] fatal:", e);
  process.exit(1);
});
