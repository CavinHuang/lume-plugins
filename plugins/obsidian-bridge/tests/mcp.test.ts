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
