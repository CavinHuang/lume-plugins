import { test } from "node:test";
import assert from "node:assert/strict";
import { createObsidianClient, BridgeError } from "../src/mcp/obsidian-client.ts";
import { ERROR_CODES } from "../src/shared/protocol.ts";

function mockFetch(routes: Record<string, { status: number; body: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const u = new URL(String(url));
    const key = `${init?.method || "GET"} ${u.pathname}`;
    const r = routes[key] ?? routes[u.pathname];
    if (!r) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { f, calls };
}

test("health 无 token", async () => {
  const { f } = mockFetch({
    "/health": { status: 200, body: { ok: true, protocol: 1, vaultName: "V" } },
  });
  const c = createObsidianClient({
    baseUrl: "http://x",
    getToken: async () => null,
    fetchImpl: f as unknown as typeof fetch,
  });
  const r = await c.health();
  assert.equal(r.vaultName, "V");
});

test("readNote 带 token 与协议头", async () => {
  const { f, calls } = mockFetch({
    "GET /notes": { status: 200, body: { path: "a.md", content: "hi" } },
  });
  const c = createObsidianClient({
    baseUrl: "http://x",
    getToken: async () => "TOK",
    fetchImpl: f as unknown as typeof fetch,
  });
  const r = await c.readNote("a.md");
  assert.equal(r.content, "hi");
  const h = calls[0].init!.headers as Record<string, string>;
  assert.equal(h.authorization, "Bearer TOK");
  assert.equal(h["x-protocol-version"], "1");
});

test("upsertNote 到需确认区重试 X-Confirmed", async () => {
  const seq = [
    { status: 409, body: { error: { code: ERROR_CODES.needs_confirmation } } },
    { status: 201, body: { ok: true } },
  ];
  let i = 0;
  const fetchImpl = async () => {
    const cur = seq[i];
    i++;
    return new Response(JSON.stringify(cur.body), {
      status: cur.status,
      headers: { "content-type": "application/json" },
    });
  };
  const c = createObsidianClient({
    baseUrl: "http://x",
    getToken: async () => "TOK",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  await c.upsertNote("people/z.md", "c", { confirmed: true });
  assert.equal(i, 2); // 第一次 409 → 重试带 X-Confirmed → 第二次 201
});

test("unreachable 抛 bridge_unreachable", async () => {
  const c = createObsidianClient({
    baseUrl: "http://127.0.0.1:1",
    getToken: async () => "TOK",
    fetchImpl: (async () => {
      throw new Error("net");
    }) as unknown as typeof fetch,
  });
  await assert.rejects(
    () => c.readNote("a.md"),
    (e: unknown) => e instanceof BridgeError && e.code === ERROR_CODES.bridge_unreachable,
  );
});
