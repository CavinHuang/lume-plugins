import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createObsidianClient } from "../src/mcp/obsidian-client.ts";

test("read_note tool 链路:client → GET /notes with token", async () => {
  const calls: string[] = [];
  const srv = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url} auth=${req.headers.authorization}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ path: "a.md", content: "hi" }));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const client = createObsidianClient({
    baseUrl: `http://127.0.0.1:${port}`,
    getToken: async () => "TOK",
  });
  const r = await client.readNote("a.md");
  assert.equal(r.content, "hi");
  assert.match(calls[0], /GET \/notes\?path=a\.md auth=Bearer TOK/);

  await new Promise<void>((r) => srv.close(() => r()));
});

test("read_palace 链路:GET /palace/:room", async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        trigger: "t",
        mustRead: ["profile.md"],
        conditionalRead: [],
        outputLocation: "memory/inbox/x.md",
        pitfalls: [],
      }),
    );
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;

  const client = createObsidianClient({
    baseUrl: `http://127.0.0.1:${port}`,
    getToken: async () => "TOK",
  });
  const card = await client.readPalace("digest_note_room");
  assert.deepEqual(card.mustRead, ["profile.md"]);

  await new Promise<void>((r) => srv.close(() => r()));
});

test("graphNeighbors 链路:GET /graph/neighbors", async () => {
  const calls: string[] = [];
  const srv = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ nodes: [{ path: "b.md", depth: 1, via: "a.md" }] }));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;

  const client = createObsidianClient({
    baseUrl: `http://127.0.0.1:${port}`,
    getToken: async () => "T",
  });
  const r = await client.graphNeighbors("a.md", 1, "both");
  assert.equal(r[0].path, "b.md");
  assert.match(calls[0], /GET \/graph\/neighbors\?path=a\.md&depth=1&direction=both/);

  await new Promise<void>((r) => srv.close(() => r()));
});

test("graphPath 链路:GET /graph/path 返回 path 与 hops", async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ path: ["a.md", "b.md", "c.md"], hops: 2 }));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;

  const client = createObsidianClient({
    baseUrl: `http://127.0.0.1:${port}`,
    getToken: async () => "T",
  });
  const r = await client.graphPath("a.md", "c.md");
  assert.deepEqual(r.path, ["a.md", "b.md", "c.md"]);
  assert.equal(r.hops, 2);

  await new Promise<void>((r) => srv.close(() => r()));
});

test("graphStructure 链路:GET /graph/structure", async () => {
  const calls: string[] = [];
  const srv = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        hubs: ["b.md"],
        orphans: ["l.md"],
        bridges: [{ from: "c.md", to: "d.md" }],
      }),
    );
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;

  const client = createObsidianClient({
    baseUrl: `http://127.0.0.1:${port}`,
    getToken: async () => "T",
  });
  const r = await client.graphStructure(5);
  assert.deepEqual(r.hubs, ["b.md"]);
  assert.deepEqual(r.bridges, [{ from: "c.md", to: "d.md" }]);
  assert.match(calls[0], /GET \/graph\/structure\?top=5/);

  await new Promise<void>((r) => srv.close(() => r()));
});

test("graphStructure 链路:无 top 时不带 query", async () => {
  const calls: string[] = [];
  const srv = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ hubs: [], orphans: [], bridges: [] }));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;

  const client = createObsidianClient({
    baseUrl: `http://127.0.0.1:${port}`,
    getToken: async () => "T",
  });
  await client.graphStructure();
  assert.match(calls[0], /GET \/graph\/structure$/);

  await new Promise<void>((r) => srv.close(() => r()));
});

test("graphSimilar 链路:GET /graph/similar 解包 similar 数组", async () => {
  const calls: string[] = [];
  const srv = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ similar: [{ path: "y.md", score: 0.5 }] }));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;

  const client = createObsidianClient({
    baseUrl: `http://127.0.0.1:${port}`,
    getToken: async () => "T",
  });
  const r = await client.graphSimilar("x.md", 5);
  assert.deepEqual(r, [{ path: "y.md", score: 0.5 }]);
  assert.match(calls[0], /GET \/graph\/similar\?path=x\.md&limit=5/);

  await new Promise<void>((r) => srv.close(() => r()));
});

test("graphSimilar 链路:无 limit 时不带 limit query", async () => {
  const calls: string[] = [];
  const srv = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ similar: [] }));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;

  const client = createObsidianClient({
    baseUrl: `http://127.0.0.1:${port}`,
    getToken: async () => "T",
  });
  await client.graphSimilar("x.md");
  assert.match(calls[0], /GET \/graph\/similar\?path=x\.md$/);

  await new Promise<void>((r) => srv.close(() => r()));
});
