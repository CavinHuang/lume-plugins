"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/obsidian-app/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ObsidianBridgePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/obsidian-app/server.ts
var import_node_http = __toESM(require("node:http"), 1);

// src/shared/protocol.ts
var PROTOCOL_VERSION = 1;
var ERROR_CODES = {
  bridge_unreachable: "bridge_unreachable",
  token_invalid: "token_invalid",
  vault_mismatch: "vault_mismatch",
  protocol_mismatch: "protocol_mismatch",
  raw_readonly: "raw_readonly",
  needs_confirmation: "needs_confirmation",
  not_found: "not_found",
  merge_conflict: "merge_conflict"
};

// src/obsidian-app/trust-policy.ts
var CONFIRMED_HEADER = "x-confirmed";
var NEEDS_CONFIRM_PREFIXES = ["people/", "projects/", "wiki/", "decisions/", "daily/", "palace/"];
var NEEDS_CONFIRM_FILES = ["profile.md", "vault.md", "style.md", "memory_policy.md"];
function classifyTrust(path) {
  const p = path.replace(/^\//, "").toLowerCase();
  if (p === "raw/" || p.startsWith("raw/")) return "raw_readonly";
  if (p === "sources/" || p.startsWith("sources/")) return "free_write";
  if (p === "memory/inbox/" || p.startsWith("memory/inbox/")) return "free_write";
  if (p === "memory/feedback/" || p.startsWith("memory/feedback/")) return "free_write";
  if (NEEDS_CONFIRM_FILES.includes(p)) return "needs_confirmation";
  if (NEEDS_CONFIRM_PREFIXES.some((pre) => p.startsWith(pre))) return "needs_confirmation";
  return "free";
}
function isWrite(method) {
  return ["POST", "PATCH", "DELETE"].includes(method.toUpperCase());
}

// src/obsidian-app/palace.ts
var SECTION_TITLES = {
  trigger: /^##\s*触发场景/m,
  mustRead: /^##\s*必读(（按顺序）|\(按顺序\))?/m,
  conditionalRead: /^##\s*条件读/m,
  outputLocation: /^##\s*输出位置/m,
  pitfalls: /^##\s*坑\s*\/\s*禁区/m
};
function splitList(block) {
  return block.split("\n").map((l) => l.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
}
function parseRoomCard(markdown) {
  const card = {
    trigger: "",
    mustRead: [],
    conditionalRead: [],
    outputLocation: "",
    pitfalls: []
  };
  const keys = Object.keys(SECTION_TITLES);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const startMatch = markdown.match(SECTION_TITLES[key]);
    if (!startMatch || startMatch.index === void 0) continue;
    const start = startMatch.index + startMatch[0].length;
    const nextIdx = keys.slice(i + 1).map((k) => markdown.slice(start).match(SECTION_TITLES[k])).find((m) => m && m.index !== void 0);
    const end = nextIdx && nextIdx.index !== void 0 ? start + nextIdx.index : markdown.length;
    const block = markdown.slice(start, end).trim();
    if (key === "trigger" || key === "outputLocation") {
      card[key] = block;
    } else {
      card[key] = splitList(block);
    }
  }
  return card;
}

// src/obsidian-app/http-router.ts
function err(code, message, status, details) {
  const e = { error: { code, message, ...details ? { details } : {} } };
  return { status, body: e };
}
function createRouter(deps) {
  async function authed(req) {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    return deps.pairing.isActive(token) ? token : null;
  }
  return async function handle(req) {
    if (req.path !== "/health") {
      const v = Number(req.headers["x-protocol-version"] ?? PROTOCOL_VERSION);
      const major = Math.floor(v);
      if (major !== PROTOCOL_VERSION) {
        return err(ERROR_CODES.protocol_mismatch, `protocol v${major} not supported`, 426);
      }
    }
    if (req.method === "GET" && req.path === "/health") {
      return {
        status: 200,
        body: { ok: true, protocol: PROTOCOL_VERSION, appVersion: deps.appVersion, vaultName: deps.vaultName }
      };
    }
    if (req.method === "POST" && req.path === "/pair") {
      const code = req.body?.code ?? "";
      const token2 = deps.pairing.consumeCode(code);
      if (!token2) return err(ERROR_CODES.token_invalid, "invalid or expired pairing code", 401);
      return { status: 200, body: { token: token2, vaultName: deps.vaultName } };
    }
    const token = await authed(req);
    if (!token) return err(ERROR_CODES.token_invalid, "missing or invalid token", 401);
    if (isWrite(req.method) && req.path === "/notes") {
      const path = String(req.body?.path ?? "");
      const level = classifyTrust(path);
      if (level === "raw_readonly") return err(ERROR_CODES.raw_readonly, "raw/ is readonly", 403);
      if (level === "needs_confirmation" && req.headers[CONFIRMED_HEADER] !== "true") {
        return err(
          ERROR_CODES.needs_confirmation,
          `writing to ${path} requires confirmation; retry the same request with header X-Confirmed: true (or MCP param confirmed=true)`,
          409,
          { path, method: req.method }
        );
      }
    }
    if (req.path === "/notes") {
      const q = req.query ?? {};
      if (req.method === "GET") {
        if (q.list !== void 0) {
          return { status: 200, body: { paths: await deps.vault.listNotes(q.list) } };
        }
        if (!await deps.vault.exists(q.path)) return err(ERROR_CODES.not_found, "not found", 404);
        return { status: 200, body: { path: q.path, content: await deps.vault.read(q.path) } };
      }
      const b = req.body;
      if (req.method === "POST") {
        await deps.vault.write(b.path, b.content);
        return { status: 201, body: { ok: true, path: b.path } };
      }
      if (req.method === "PATCH") {
        await deps.vault.patch(
          b.path,
          req.body.patch
        );
        return { status: 200, body: { ok: true } };
      }
      if (req.method === "DELETE") {
        await deps.vault.delete(q.path);
        return { status: 200, body: { ok: true } };
      }
    }
    if (req.method === "GET" && req.path === "/search") {
      const q = req.query ?? {};
      return {
        status: 200,
        body: {
          hits: await deps.vault.search(q.q ?? "", {
            type: q.type,
            limit: Number(q.limit ?? 50)
          })
        }
      };
    }
    if (req.method === "GET" && req.path === "/metadata") {
      return { status: 200, body: await deps.vault.metadata(req.query?.path ?? "") };
    }
    if (req.method === "GET" && req.path === "/backlinks") {
      return { status: 200, body: { backlinks: await deps.vault.backlinks(req.query?.path ?? "") } };
    }
    if (req.method === "GET" && req.path === "/diagnostics") {
      return { status: 200, body: await deps.vault.diagnostics() };
    }
    if (req.method === "GET" && req.path.startsWith("/palace/")) {
      const room = req.path.slice("/palace/".length);
      const md = await deps.getRoomMarkdown(room);
      return { status: 200, body: parseRoomCard(md) };
    }
    if (req.method === "GET" && req.path === "/graph/neighbors") {
      const q = req.query ?? {};
      const depth = Math.min(Math.max(Number(q.depth ?? 1) || 1, 1), 3);
      const direction = q.direction === "fwd" || q.direction === "back" ? q.direction : "both";
      const nodes = await deps.vault.graphNeighbors(q.path ?? "", depth, direction);
      return { status: 200, body: { nodes } };
    }
    if (req.method === "GET" && req.path === "/graph/path") {
      const q = req.query ?? {};
      const path = await deps.vault.graphPath(q.from ?? "", q.to ?? "");
      return { status: 200, body: { path, hops: Math.max(0, path.length - 1) } };
    }
    if (req.method === "GET" && req.path === "/graph/structure") {
      const q = req.query ?? {};
      const top = q.top ? Math.min(Math.max(Number(q.top) || 10, 1), 100) : 10;
      return { status: 200, body: deps.vault.graphStructure(top) };
    }
    if (req.method === "GET" && req.path === "/events") {
      return err(ERROR_CODES.not_found, "events stream not implemented in Phase 1", 501);
    }
    return err(ERROR_CODES.not_found, `no route for ${req.method} ${req.path}`, 404);
  };
}

// src/obsidian-app/server.ts
function startServer(opts) {
  const handle = createRouter({
    vault: opts.vault,
    pairing: opts.pairing,
    vaultName: opts.vaultName,
    appVersion: opts.appVersion,
    getRoomMarkdown: opts.getRoomMarkdown
  });
  async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text) return "";
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  const server = import_node_http.default.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const query = {};
      url.searchParams.forEach((v, k) => {
        query[k] = v;
      });
      const rreq = {
        method: req.method ?? "GET",
        path: url.pathname,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [
            k.toLowerCase(),
            Array.isArray(v) ? v[0] : v ?? ""
          ])
        ),
        body: await readBody(req),
        query
      };
      const rres = await handle(rreq);
      res.writeHead(rres.status, {
        "content-type": "application/json",
        ...rres.headers ?? {}
      });
      res.end(JSON.stringify(rres.body));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "not_found", message: String(e) } }));
    }
  });
  server.listen(opts.port, "127.0.0.1");
  return { close: () => server.close(), port: opts.port };
}

// src/obsidian-app/graph-engine.ts
function neighbors(adj, start, depth) {
  const out = [];
  if (!adj.has(start) || depth <= 0) return out;
  const seen = /* @__PURE__ */ new Set([start]);
  let frontier = [{ path: start, depth: 0, via: start }];
  for (let d = 1; d <= depth; d++) {
    const next = [];
    for (const node of frontier) {
      for (const n of adj.get(node.path) ?? /* @__PURE__ */ new Set()) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push({ path: n, depth: d, via: node.path });
      }
    }
    out.push(...next);
    frontier = next;
    if (next.length === 0) break;
  }
  return out;
}
function shortestPath(adj, from, to) {
  if (!adj.has(from) || !adj.has(to)) return [];
  if (from === to) return [from];
  const prev = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of adj.get(cur) ?? /* @__PURE__ */ new Set()) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      if (n === to) {
        const path = [to];
        let c = to;
        while (c !== from) {
          c = prev.get(c);
          path.unshift(c);
        }
        return path;
      }
      queue.push(n);
    }
  }
  return [];
}
function structure(adj, top = 10) {
  const hubs = [...adj.entries()].filter(([, ns]) => ns.size > 0).sort((a, b) => b[1].size - a[1].size).slice(0, top).map(([n]) => n);
  const orphans = [...adj.entries()].filter(([, ns]) => ns.size === 0).map(([n]) => n);
  const bridges = findBridges(adj);
  return { hubs, orphans, bridges };
}
function findBridges(adj) {
  const result = [];
  const disc = /* @__PURE__ */ new Map();
  const low = /* @__PURE__ */ new Map();
  const visited = /* @__PURE__ */ new Set();
  let time = 0;
  function dfs(u, parent) {
    visited.add(u);
    disc.set(u, time);
    low.set(u, time);
    time++;
    for (const v of adj.get(u) ?? /* @__PURE__ */ new Set()) {
      if (!visited.has(v)) {
        dfs(v, u);
        low.set(u, Math.min(low.get(u), low.get(v)));
        if (low.get(v) > disc.get(u)) {
          result.push(u < v ? { from: u, to: v } : { from: v, to: u });
        }
      } else if (v !== parent) {
        low.set(u, Math.min(low.get(u), disc.get(v)));
      }
    }
  }
  for (const node of adj.keys()) {
    if (!visited.has(node)) dfs(node, null);
  }
  return result;
}

// src/obsidian-app/vault-service.ts
function createVaultService(app) {
  function buildAdjacencies() {
    const fwd = /* @__PURE__ */ new Map();
    const back = /* @__PURE__ */ new Map();
    const both = /* @__PURE__ */ new Map();
    const ensure = (p) => {
      if (!fwd.has(p)) {
        fwd.set(p, /* @__PURE__ */ new Set());
        back.set(p, /* @__PURE__ */ new Set());
        both.set(p, /* @__PURE__ */ new Set());
      }
    };
    for (const f of app.vault.getMarkdownFiles()) ensure(f.path);
    for (const [src, links] of Object.entries(app.metadataCache.resolvedLinks)) {
      ensure(src);
      for (const tgt of Object.keys(links)) {
        ensure(tgt);
        fwd.get(src).add(tgt);
        back.get(tgt).add(src);
        both.get(src).add(tgt);
        both.get(tgt).add(src);
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
        content = "---\n" + Object.entries(frontmatter).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n") + "\n---\n" + content;
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
      const hits = [];
      for (const f of app.vault.getMarkdownFiles()) {
        const mtime = f.stat?.mtime ?? 0;
        if (opts.type === "tag") {
          const cache = app.metadataCache.getFileCache(f);
          const tags = cache?.tags ? Object.keys(cache.tags).map((t) => t.replace(/^#/, "").toLowerCase()) : [];
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
              mtime
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
        ctime: f?.stat?.ctime ?? 0
      };
    },
    async backlinks(path) {
      const target = path.replace(/\.md$/, "");
      const out = [];
      for (const [src, links] of Object.entries(app.metadataCache.resolvedLinks)) {
        for (const [tgt, count] of Object.entries(links)) {
          if (tgt === path || tgt.replace(/\.md$/, "") === target) {
            out.push({ fromPath: src, occurrences: count });
          }
        }
      }
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
      return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix)).map((f) => f.path);
    },
    async diagnostics() {
      const brokenLinks = [];
      for (const [src, links] of Object.entries(app.metadataCache.unresolvedLinks)) {
        for (const link of links) brokenLinks.push({ from: src, link });
      }
      const allFiles = app.vault.getMarkdownFiles().map((f) => f.path);
      const connected = /* @__PURE__ */ new Set();
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
    }
  };
}

// src/obsidian-app/pairing-store.ts
function createPairingStore(deps) {
  let code = null;
  let token = null;
  function newToken() {
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return {
    generateCode() {
      code = { value: deps.random(), expiresAt: deps.now() + deps.ttlMs };
      return code.value;
    },
    consumeCode(input) {
      if (!code) return null;
      if (deps.now() > code.expiresAt) {
        code = null;
        return null;
      }
      if (input !== code.value) return null;
      code = null;
      token = newToken();
      return token;
    },
    isActive(t) {
      return token !== null && t === token;
    },
    reset() {
      code = null;
      token = null;
    }
  };
}
function createDefaultPairingStore(ttlMs = 6e5) {
  return createPairingStore({
    ttlMs,
    now: () => Date.now(),
    random: () => String(Math.floor(Math.random() * 1e6)).padStart(6, "0")
  });
}

// src/obsidian-app/boot.ts
var DEFAULT_PORT = 43112;
var DIGEST_ROOM_MD = `# digest_note_room

## \u89E6\u53D1\u573A\u666F
\u7528\u6237\u8BF7\u6C42\u6D88\u5316\u4E00\u7BC7\u7B14\u8BB0(\u6216\u9009\u533A)\u65F6\u8FDB\u5165\u6B64\u623F\u95F4\u3002

## \u5FC5\u8BFB(\u6309\u987A\u5E8F)
- profile.md
- vault.md
- style.md
- <\u5F53\u524D\u5F85\u6D88\u5316\u7B14\u8BB0>

## \u6761\u4EF6\u8BFB
- \u6D89\u53CA\u4EBA:people/<\u8C01>.md
- \u6D89\u53CA\u9879\u76EE:projects/<\u4EC0\u4E48>.md

## \u8F93\u51FA\u4F4D\u7F6E
memory/inbox/<YYYY-MM-DD>.md

## \u5751 / \u7981\u533A
- \u4E0D\u8981\u76F4\u63A5\u5199 people/ \u6216 projects/(\u9700\u8D70\u786E\u8BA4\u95E8)
- inbox \u6587\u4EF6\u53EF\u81EA\u7531\u5199,\u4E0D\u5F39\u786E\u8BA4
`;
var REVIEW_INBOX_ROOM_MD = `# review_inbox_room

## \u89E6\u53D1\u573A\u666F
\u7528\u6237\u8BF7\u6C42\u5BA1\u6838 memory/inbox/ \u5F85\u6C89\u6DC0\u6761\u76EE\u65F6\u8FDB\u5165\u6B64\u623F\u95F4\u3002

## \u5FC5\u8BFB(\u6309\u987A\u5E8F)
- vault.md
- memory_policy.md
- \u7528 list_notes \u5217\u51FA memory/inbox/ \u5168\u90E8\u6587\u4EF6

## \u6761\u4EF6\u8BFB
- \u6761\u76EE\u6D89\u53CA\u4EBA:people/<\u8C01>.md(\u82E5\u5B58\u5728)
- \u6761\u76EE\u6D89\u53CA\u9879\u76EE:projects/<\u4EC0\u4E48>.md(\u82E5\u5B58\u5728)

## \u8F93\u51FA\u4F4D\u7F6E
\u5411\u7528\u6237\u8F93\u51FA\u300C\u53EF\u786E\u8BA4\u6E05\u5355\u300D(\u4E0D\u5199\u6587\u4EF6):\u6BCF\u6761\u542B\u6765\u6E90\u3001\u5EFA\u8BAE\u53BB\u5411(people/projects/wiki/\u4E22\u5F03)\u3001\u7F6E\u4FE1\u5EA6\u3002

## \u5751 / \u7981\u533A
- \u53EA\u8BFB inbox,\u4E0D\u4FEE\u6539 inbox \u6587\u4EF6
- \u4E0D\u8981\u5728\u6B64\u9636\u6BB5\u5199\u957F\u671F\u8BB0\u5FC6(\u4EA4\u7ED9 apply-memory)
`;
var APPLY_MEMORY_ROOM_MD = `# apply_memory_room

## \u89E6\u53D1\u573A\u666F
\u7528\u6237\u786E\u8BA4 review-inbox \u7684\u6E05\u5355\u540E,\u628A\u6761\u76EE\u6C89\u6DC0\u5230\u957F\u671F\u8BB0\u5FC6\u65F6\u8FDB\u5165\u6B64\u623F\u95F4\u3002

## \u5FC5\u8BFB(\u6309\u987A\u5E8F)
- profile.md
- vault.md
- \u7528\u6237\u786E\u8BA4\u7684\u6E05\u5355

## \u6761\u4EF6\u8BFB
- \u76EE\u6807\u4EBA\u7269:people/<\u8C01>.md(\u82E5\u5DF2\u5B58\u5728,\u9700\u5408\u5E76\u800C\u975E\u8986\u76D6)
- \u76EE\u6807\u9879\u76EE:projects/<\u4EC0\u4E48>.md(\u540C\u4E0A)

## \u8F93\u51FA\u4F4D\u7F6E
people/ \u3001projects/ \u3001wiki/ \u4E0B\u5BF9\u5E94\u6587\u4EF6(\u957F\u671F\u8BB0\u5FC6\u533A)\u3002

## \u5751 / \u7981\u533A
- \u957F\u671F\u8BB0\u5FC6\u533A\u5199\u5165\u5FC5\u987B\u5E26 confirmed=true(\u8D70\u786E\u8BA4\u95E8)
- \u5DF2\u5B58\u5728\u6587\u4EF6\u4F18\u5148\u8FFD\u52A0,\u907F\u514D\u8986\u76D6\u5386\u53F2
`;
var UPDATE_PROFILE_ROOM_MD = `# update_profile_room

## \u89E6\u53D1\u573A\u666F
\u7528\u6237\u8BF7\u6C42\u4ECE memory/feedback/ \u53CD\u9988\u4E2D\u5B66\u4E60\u3001\u66F4\u65B0\u753B\u50CF\u65F6\u8FDB\u5165\u6B64\u623F\u95F4\u3002

## \u5FC5\u8BFB(\u6309\u987A\u5E8F)
- profile.md
- style.md
- \u7528 list_notes \u5217\u51FA memory/feedback/ \u5168\u90E8\u6587\u4EF6\u5E76\u9010\u6761\u8BFB\u53D6

## \u6761\u4EF6\u8BFB
- \u65E0

## \u8F93\u51FA\u4F4D\u7F6E
profile.md \u3001style.md(\u6839\u7EA7\u753B\u50CF\u6587\u4EF6)\u3002

## \u5751 / \u7981\u533A
- \u5199\u5165\u5FC5\u987B\u5E26 confirmed=true
- \u53EA\u63D0\u70BC\u7A33\u5B9A\u6A21\u5F0F,\u5FFD\u7565\u5076\u53D1\u53CD\u9988;\u6BCF\u6B21\u66F4\u65B0\u9010\u6761\u8BA9\u7528\u6237\u786E\u8BA4
`;
var VAULT_DOCTOR_ROOM_MD = `# vault_doctor_room

## \u89E6\u53D1\u573A\u666F
\u7528\u6237\u8BF7\u6C42\u7ED9 Vault \u505A\u4F53\u68C0\u65F6\u8FDB\u5165\u6B64\u623F\u95F4\u3002

## \u5FC5\u8BFB(\u6309\u987A\u5E8F)
- vault.md
- \u8C03\u7528 vault_diagnostics \u53D6\u65AD\u94FE/\u5B64\u513F/raw \u672A\u6D88\u5316

## \u6761\u4EF6\u8BFB
- \u7528 list_notes \u5217 raw/ \u6838\u5BF9\u672A\u6D88\u5316\u6E05\u5355
- \u7528 list_notes \u5217 memory/inbox/ \u6838\u5BF9\u79EF\u538B

## \u8F93\u51FA\u4F4D\u7F6E
\u5411\u7528\u6237\u8F93\u51FA\u4F53\u68C0\u62A5\u544A(\u4E0D\u5199\u6587\u4EF6):\u5206\u7C7B\u5217\u51FA\u95EE\u9898 + \u6BCF\u7C7B\u7684\u4E0B\u4E00\u6B65\u5EFA\u8BAE\u6280\u80FD\u3002

## \u5751 / \u7981\u533A
- \u53EA\u8BFB\u4E0D\u5199
- \u62A5\u544A\u91CC\u5F15\u7528\u5177\u4F53\u8DEF\u5F84,\u4FBF\u4E8E\u7528\u6237\u5B9A\u4F4D
`;
var PALACE_ROOMS = [
  { path: "palace/digest_note_room.md", md: DIGEST_ROOM_MD },
  { path: "palace/review_inbox_room.md", md: REVIEW_INBOX_ROOM_MD },
  { path: "palace/apply_memory_room.md", md: APPLY_MEMORY_ROOM_MD },
  { path: "palace/update_profile_room.md", md: UPDATE_PROFILE_ROOM_MD },
  { path: "palace/vault_doctor_room.md", md: VAULT_DOCTOR_ROOM_MD }
];
async function ensurePalaceRooms(app) {
  for (const room of PALACE_ROOMS) {
    if (app.vault.getAbstractFileByPath(room.path)) continue;
    try {
      await app.vault.create(room.path, room.md);
    } catch {
    }
  }
}

// src/obsidian-app/pairing-ui.ts
function formatPairingCode(code) {
  if (!code) {
    return "\u2014";
  }
  return code.match(/.{1,3}/g)?.join(" ") ?? code;
}

// src/obsidian-app/main.ts
var ObsidianBridgePlugin = class extends import_obsidian.Plugin {
  server;
  pairing;
  pairingCode = "";
  async onload() {
    const pairing = createDefaultPairingStore();
    this.pairing = pairing;
    this.pairingCode = pairing.generateCode();
    await ensurePalaceRooms(this.app);
    this.server = startServer({
      port: DEFAULT_PORT,
      vault: createVaultService(this.app),
      pairing,
      vaultName: this.app.vault.getName(),
      appVersion: this.manifest.version,
      getRoomMarkdown: async (room) => {
        const f = this.app.vault.getAbstractFileByPath(`palace/${room}.md`);
        return f ? await this.app.vault.read(f) : "## \u89E6\u53D1\u573A\u666F\n(\u7A7A\u623F\u95F4)\n";
      }
    });
    this.addSettingTab(new BridgeSettingTab(this.app, this));
  }
  onunload() {
    this.server?.close();
  }
  regeneratePairingCode() {
    if (!this.pairing) {
      return "";
    }
    this.pairingCode = this.pairing.generateCode();
    return this.pairingCode;
  }
};
var BridgeSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Obsidian Bridge" });
    const description = containerEl.createEl("p", {
      text: "\u8BA9 Lume \u5B89\u5168\u8FDE\u63A5\u5F53\u524D Vault\u3002"
    });
    description.style.color = "var(--text-muted)";
    this.renderPairingPanel(containerEl);
  }
  renderPairingPanel(containerEl) {
    const panel = containerEl.createDiv();
    panel.style.background = "var(--background-secondary)";
    panel.style.border = "1px solid var(--background-modifier-border)";
    panel.style.borderRadius = "8px";
    panel.style.padding = "18px";
    panel.style.maxWidth = "560px";
    const statusLabel = panel.createEl("div", { text: "\u72B6\u6001" });
    statusLabel.style.fontWeight = "600";
    statusLabel.style.marginBottom = "8px";
    const statusRow = panel.createDiv();
    statusRow.style.display = "flex";
    statusRow.style.alignItems = "center";
    statusRow.style.gap = "8px";
    statusRow.style.marginBottom = "18px";
    const statusDot = statusRow.createSpan({ text: "\u25CF" });
    statusDot.style.color = "var(--text-accent)";
    statusRow.createSpan({ text: `\u672C\u5730\u670D\u52A1\u8FD0\u884C\u4E2D  127.0.0.1:${DEFAULT_PORT}` });
    this.renderCodeRow(panel, this.plugin.pairingCode);
    const hint = panel.createEl("p", {
      text: "10 \u5206\u949F\u5185\u6709\u6548\u3002\u590D\u5236\u540E\u56DE\u5230 Lume \u5BF9\u8BDD\u53D1\u9001\u3002"
    });
    hint.style.color = "var(--text-muted)";
    hint.style.marginTop = "10px";
    hint.style.marginBottom = "16px";
    const regenerateButton = panel.createEl("button", { text: "\u91CD\u65B0\u751F\u6210\u914D\u5BF9\u7801" });
    regenerateButton.addEventListener("click", () => {
      this.plugin.regeneratePairingCode();
      new import_obsidian.Notice("\u5DF2\u751F\u6210\u65B0\u7684\u914D\u5BF9\u7801");
      this.display();
    });
  }
  renderCodeRow(parent, code) {
    const codeLabel = parent.createEl("div", { text: "\u914D\u5BF9\u7801" });
    codeLabel.style.fontWeight = "600";
    codeLabel.style.marginBottom = "8px";
    const codeRow = parent.createDiv();
    codeRow.style.display = "flex";
    codeRow.style.alignItems = "stretch";
    codeRow.style.flexWrap = "wrap";
    codeRow.style.gap = "10px";
    const codeBox = codeRow.createDiv();
    codeBox.style.background = "var(--background-primary)";
    codeBox.style.border = "1px solid var(--background-modifier-border)";
    codeBox.style.borderRadius = "8px";
    codeBox.style.fontFamily = "var(--font-monospace)";
    codeBox.style.fontSize = "32px";
    codeBox.style.fontWeight = "700";
    codeBox.style.letterSpacing = "0";
    codeBox.style.lineHeight = "1";
    codeBox.style.minWidth = "220px";
    codeBox.style.padding = "16px 22px";
    codeBox.style.textAlign = "center";
    codeBox.style.userSelect = "text";
    codeBox.setText(formatPairingCode(code));
    const copyButton = codeRow.createEl("button", { text: "\u590D\u5236", cls: "mod-cta" });
    copyButton.disabled = !code;
    copyButton.addEventListener("click", () => {
      void this.copyPairingCode(code, copyButton);
    });
  }
  async copyPairingCode(code, button) {
    try {
      await copyTextToClipboard(code);
      new import_obsidian.Notice("\u914D\u5BF9\u7801\u5DF2\u590D\u5236");
      const previousText = button.textContent ?? "\u590D\u5236";
      button.textContent = "\u5DF2\u590D\u5236";
      window.setTimeout(() => {
        button.textContent = previousText;
      }, 1200);
    } catch {
      new import_obsidian.Notice("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u590D\u5236\u914D\u5BF9\u7801");
    }
  }
};
async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.left = "-9999px";
  textarea.style.position = "fixed";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("copy_failed");
    }
  } finally {
    textarea.remove();
  }
}
