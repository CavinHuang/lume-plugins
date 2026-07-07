import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter, type VaultService } from "../src/obsidian-app/http-router.ts";
import { createPairingStore } from "../src/obsidian-app/pairing-store.ts";
import { ERROR_CODES } from "../src/shared/protocol.ts";

function mockVault(over: Partial<VaultService> = {}): VaultService {
  return {
    async read() {
      return "# note";
    },
    async exists() {
      return true;
    },
    async write() {},
    async patch() {},
    async delete() {},
    async search() {
      return [];
    },
    async metadata() {
      return { tags: [], frontmatter: {}, mtime: 0, ctime: 0 };
    },
    async backlinks() {
      return [];
    },
    async listNotes() {
      return [];
    },
    async diagnostics() {
      return { brokenLinks: [], orphans: [], rawUndigested: [] };
    },
    ...over,
  };
}

const base = {
  pairing: createPairingStore({ ttlMs: 600000, now: () => 1000, random: () => "112233" }),
  vaultName: "TestVault",
  appVersion: "0.0.0-test",
  getRoomMarkdown: async () => "## 触发场景\nx\n",
};

function freshToken(): string {
  base.pairing.generateCode();
  return base.pairing.consumeCode("112233")!;
}

test("/health 无需鉴权,返回 vaultName 与协议版本", async () => {
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({ method: "GET", path: "/health", headers: {}, body: "" });
  assert.equal(res.status, 200);
  assert.equal((res.body as { ok: boolean }).ok, true);
  assert.equal((res.body as { vaultName: string }).vaultName, "TestVault");
  assert.equal((res.body as { protocol: number }).protocol, 1);
});

test("受保护端点无 token 返回 401", async () => {
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({
    method: "GET",
    path: "/notes",
    headers: {},
    body: "",
    query: { path: "a.md" },
  });
  assert.equal(res.status, 401);
  assert.equal((res.body as ApiErr).error.code, ERROR_CODES.token_invalid);
});

test("POST /notes 到 raw/ 返回 403 raw_readonly", async () => {
  const token = freshToken();
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({
    method: "POST",
    path: "/notes",
    headers: { authorization: `Bearer ${token}` },
    body: { path: "raw/x.md", content: "x" },
  });
  assert.equal(res.status, 403);
  assert.equal((res.body as ApiErr).error.code, ERROR_CODES.raw_readonly);
});

test("POST /notes 到 people/ 无 X-Confirmed 返回 409 needs_confirmation", async () => {
  const token = freshToken();
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({
    method: "POST",
    path: "/notes",
    headers: { authorization: `Bearer ${token}` },
    body: { path: "people/zhang.md", content: "x" },
  });
  assert.equal(res.status, 409);
  assert.equal((res.body as ApiErr).error.code, ERROR_CODES.needs_confirmation);
});

test("POST /notes 到 people/ 的 409 message 含路径与重试指引", async () => {
  const token = freshToken();
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({
    method: "POST",
    path: "/notes",
    headers: { authorization: `Bearer ${token}` },
    body: { path: "people/zhang.md", content: "x" },
  });
  assert.equal(res.status, 409);
  const msg = (res.body as ApiErr).error.message;
  assert.match(msg, /people\/zhang\.md/);
  assert.match(msg, /confirmed/);
});

test("协议版本不匹配返回 426", async () => {
  const r = createRouter({ ...base, vault: mockVault() });
  const res = await r({
    method: "GET",
    path: "/notes",
    headers: { "x-protocol-version": "999" },
    body: "",
    query: { path: "a.md" },
  });
  assert.equal(res.status, 426);
});

test("GET /notes?list= 返回路径列表", async () => {
  const token = freshToken();
  const r = createRouter({
    ...base,
    vault: mockVault({
      async listNotes(_p: string) {
        return ["memory/inbox/a.md"];
      },
    } as Partial<VaultService>),
  });
  const res = await r({
    method: "GET",
    path: "/notes",
    headers: { authorization: `Bearer ${token}` },
    body: "",
    query: { list: "memory/inbox/" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { paths: string[] }).paths, ["memory/inbox/a.md"]);
});

test("GET /diagnostics 返回体检数据", async () => {
  const token = freshToken();
  const r = createRouter({
    ...base,
    vault: mockVault({
      async diagnostics() {
        return {
          brokenLinks: [{ from: "n.md", link: "bad" }],
          orphans: ["l.md"],
          rawUndigested: [],
        };
      },
    } as Partial<VaultService>),
  });
  const res = await r({
    method: "GET",
    path: "/diagnostics",
    headers: { authorization: `Bearer ${token}` },
    body: "",
  });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { brokenLinks: unknown[] }).brokenLinks, [
    { from: "n.md", link: "bad" },
  ]);
});

test("/health 的 appVersion 来自注入而非写死", async () => {
  const r = createRouter({ ...base, vault: mockVault(), appVersion: "9.9.9" } as any);
  const res = await r({ method: "GET", path: "/health", headers: {}, body: "" });
  assert.equal((res.body as { appVersion: string }).appVersion, "9.9.9");
});

interface ApiErr {
  error: { code: string; message: string };
}
