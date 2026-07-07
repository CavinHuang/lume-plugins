import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRouter, type VaultService } from "../src/obsidian-app/http-router.ts";
import { createPairingStore } from "../src/obsidian-app/pairing-store.ts";
import { createObsidianClient } from "../src/mcp/obsidian-client.ts";

function memVault(): VaultService {
  const store = new Map<string, string>([
    ["profile.md", "# 我是谁\n某用户"],
    ["vault.md", "# Vault\n个人知识库"],
    ["style.md", "# 风格\n简洁"],
    ["meetings/2026-07-03.md", "# 周会\n决议:上线 X;参与:张三"],
    [
      "palace/digest_note_room.md",
      "# digest_note_room\n## 触发场景\n消化\n## 必读(按顺序)\n- profile.md\n- vault.md\n- style.md\n## 条件读\n\n## 输出位置\nmemory/inbox/<date>.md\n## 坑 / 禁区\n- 不要写 people/\n",
    ],
  ]);
  return {
    async read(p) {
      return store.get(p) ?? "";
    },
    async exists(p) {
      return store.has(p);
    },
    async write(p, c) {
      store.set(p, c);
    },
    async patch() {},
    async delete(p) {
      store.delete(p);
    },
    async search(q) {
      const r: { path: string; snippet: string; score: number; mtime: number }[] = [];
      for (const [p, c] of store)
        if (c.includes(q)) r.push({ path: p, snippet: c.slice(0, 30), score: 1, mtime: 0 });
      return r;
    },
    async metadata() {
      return { tags: [], frontmatter: {}, mtime: 0, ctime: 0 };
    },
    async backlinks() {
      return [];
    },
    async listNotes() {
      return [...store.keys()];
    },
    async diagnostics() {
      return { brokenLinks: [], orphans: [], rawUndigested: [] };
    },
    buildAdjacencies() {
      return { fwd: new Map(), back: new Map(), both: new Map() };
    },
    graphNeighbors() {
      return [];
    },
    graphPath() {
      return [];
    },
    graphStructure() {
      return { hubs: [], orphans: [], bridges: [] };
    },
    graphSimilar() {
      return [];
    },
  };
}

test("digest smoke: pair → read_palace → read_note → upsert inbox", async () => {
  const pairing = createPairingStore({
    ttlMs: 600000,
    now: () => Date.now(),
    random: () => "654321",
  });
  const vault = memVault();
  const handle = createRouter({
    vault,
    pairing,
    vaultName: "Smoke",
    appVersion: "test",
    getRoomMarkdown: async (room) => vault.read(`palace/${room}.md`),
  });

  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") : "";
    const r = await handle({
      method: req.method ?? "GET",
      path: url.pathname,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k.toLowerCase(),
          Array.isArray(v) ? v[0] : v ?? "",
        ]),
      ),
      body,
      query: Object.fromEntries(url.searchParams),
    });
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(JSON.stringify(r.body));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;

  // 正确的 token 流:pair 拿到 token 后保存,后续请求复用(不是反复 consumeCode)
  let token: string | null = null;
  const client = createObsidianClient({
    baseUrl: `http://127.0.0.1:${port}`,
    getToken: async () => token,
  });
  const code = pairing.generateCode();
  const paired = await client.pair(code);
  token = paired.token;
  assert.equal(paired.vaultName, "Smoke");

  const card = await client.readPalace("digest_note_room");
  assert.ok(card.mustRead.length >= 3, "mustRead 至少 3 项");

  for (const p of card.mustRead) await client.readNote(p); // 按 mustRead 顺序读
  const note = await client.readNote("meetings/2026-07-03.md");
  assert.match(note.content, /上线 X/);

  await client.upsertNote("memory/inbox/2026-07-03.md", "- 候选:张三参与 X 上线\n");
  const inbox = await client.readNote("memory/inbox/2026-07-03.md");
  assert.match(inbox.content, /候选/);

  await new Promise<void>((r) => srv.close(() => r()));
});
