import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import net from "node:net";

function encodeClientFrame(text) {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  const header = [];
  header.push(0x81);
  if (payload.length < 126) {
    header.push(0x80 | payload.length);
  } else if (payload.length < 65536) {
    header.push(0x80 | 126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    throw new Error("test frame too large");
  }
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    masked[i] = payload[i] ^ mask[i % 4];
  }
  return Buffer.concat([Buffer.from(header), mask, masked]);
}

function decodeServerFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    }
    if (offset + headerLength + length > buffer.length) break;
    const opcode = first & 0x0f;
    const payload = buffer.subarray(offset + headerLength, offset + headerLength + length);
    if (opcode === 1) messages.push(payload.toString("utf8"));
    offset += headerLength + length;
  }
  return { messages, rest: buffer.subarray(offset) };
}

async function connectRawWebSocket(url) {
  const parsed = new URL(url);
  const key = crypto.randomBytes(16).toString("base64");
  const socket = net.connect(Number(parsed.port), parsed.hostname);
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.write([
    `GET ${parsed.pathname} HTTP/1.1`,
    `Host: ${parsed.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "\r\n",
  ].join("\r\n"));
  let pending = Buffer.alloc(0);
  await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      const marker = pending.indexOf("\r\n\r\n");
      if (marker < 0) return;
      const header = pending.subarray(0, marker).toString("utf8");
      pending = pending.subarray(marker + 4);
      socket.off("data", onData);
      if (!/^HTTP\/1\.1 101/m.test(header)) {
        reject(new Error(header));
        return;
      }
      resolve();
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });

  const messages = [];
  socket.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    const decoded = decodeServerFrames(pending);
    pending = decoded.rest;
    messages.push(...decoded.messages);
  });
  return {
    send(value) {
      socket.write(encodeClientFrame(JSON.stringify(value)));
    },
    async nextJson() {
      for (let i = 0; i < 100; i += 1) {
        const raw = messages.shift();
        if (raw) return JSON.parse(raw);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("timed out waiting for websocket message");
    },
    close() {
      socket.destroy();
    },
  };
}

test("node_repl bridge forwards agent JSON-RPC calls to a connected native host", async () => {
  const { createBrowserAppServer } = await import("../dist/client/setupNodeReplBrowserRuntime.js");
  const server = await createBrowserAppServer({ port: 0 });
  const client = await connectRawWebSocket(server.url);
  const transport = server.createTransport();

  const call = transport.send("runtime_ping", { clientType: "extension" });
  const request = await client.nextJson();
  assert.equal(request.method, "runtime_ping");
  client.send({ jsonrpc: "2.0", id: request.id, result: { ok: true, echoed: request.params } });

  assert.deepEqual(await call, { ok: true, echoed: { clientType: "extension" } });

  client.close();
  await server.close();
});

test("node_repl bridge auto-approves extension confirmation requests by default", async () => {
  const { createBrowserAppServer } = await import("../dist/client/setupNodeReplBrowserRuntime.js");
  const server = await createBrowserAppServer({ port: 0 });
  const client = await connectRawWebSocket(server.url);

  client.send({
    jsonrpc: "2.0",
    id: "ext-1",
    method: "host.confirmation.request",
    params: { reason: "Allow Lume to interact with example.com?" },
  });

  assert.deepEqual(await client.nextJson(), {
    jsonrpc: "2.0",
    id: "ext-1",
    result: { approved: true, remember: "session" },
  });

  client.close();
  await server.close();
});

test("node_repl bridge forwards browserAuth requests to a secure host callback", async () => {
  const { createBrowserAppServer } = await import("../dist/client/setupNodeReplBrowserRuntime.js");
  const server = await createBrowserAppServer({
    port: 0,
    browserAuth: async (request) => ({
      status: "approved",
      values: { password: request.origin === "https://accounts.example.test" ? "secret-value" : "" },
    }),
  });
  const client = await connectRawWebSocket(server.url);

  client.send({
    jsonrpc: "2.0",
    id: "auth-1",
    method: "host.browserAuth.request",
    params: {
      origin: "https://accounts.example.test",
      fields: [{ id: "password", label: "Password", type: "password" }],
    },
  });

  assert.deepEqual(await client.nextJson(), {
    jsonrpc: "2.0",
    id: "auth-1",
    result: { status: "approved", values: { password: "secret-value" } },
  });

  client.close();
  await server.close();
});

test("node_repl bridge returns unavailable for browserAuth without a secure host callback", async () => {
  const { createBrowserAppServer } = await import("../dist/client/setupNodeReplBrowserRuntime.js");
  const server = await createBrowserAppServer({ port: 0 });
  const client = await connectRawWebSocket(server.url);

  client.send({
    jsonrpc: "2.0",
    id: "auth-1",
    method: "host.browserAuth.request",
    params: { origin: "https://accounts.example.test", fields: [] },
  });

  assert.deepEqual(await client.nextJson(), {
    jsonrpc: "2.0",
    id: "auth-1",
    result: { status: "unavailable" },
  });

  client.close();
  await server.close();
});

test("node_repl browser runtime setup reuses an existing bridge from globals", async () => {
  const { setupNodeReplBrowserRuntime } = await import("../dist/client/setupNodeReplBrowserRuntime.js");
  const globals = {};

  const first = await setupNodeReplBrowserRuntime({ port: 0, globals });
  const second = await setupNodeReplBrowserRuntime({ port: 0, globals });

  try {
    assert.equal(second.bridge, first.bridge);
    assert.equal(second.agent, first.agent);
    assert.equal(second.context, first.context);
  } finally {
    await first.bridge.close();
    if (second.bridge !== first.bridge) await second.bridge.close();
  }
});

test("node_repl browser runtime uses a stable fallback session without request metadata", async () => {
  const { setupNodeReplBrowserRuntime } = await import("../dist/client/setupNodeReplBrowserRuntime.js");

  const first = await setupNodeReplBrowserRuntime({ port: 0, globals: {} });
  try {
    await first.bridge.close();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await setupNodeReplBrowserRuntime({ port: 0, globals: {} });
    try {
      assert.equal(second.context.browserSessionId, first.context.browserSessionId);
      assert.doesNotMatch(first.context.browserSessionId, /^node-repl-\d+$/);
    } finally {
      await second.bridge.close();
    }
  } finally {
    await first.bridge.close().catch(() => undefined);
  }
});

test("node_repl browser runtime exposes agent-friendly browser control helpers", async () => {
  const { setupNodeReplBrowserRuntime } = await import("../dist/client/setupNodeReplBrowserRuntime.js");
  const globals = {};
  const runtime = await setupNodeReplBrowserRuntime({ port: 0, globals });
  const client = await connectRawWebSocket(runtime.bridge.url);

  async function respond(result) {
    const request = await client.nextJson();
    client.send({ jsonrpc: "2.0", id: request.id, result: result ?? null });
    return request;
  }

  try {
    assert.equal(globals.lumeBrowserControl, runtime.control);
    assert.equal(globals.lumeBrowserAgent, runtime.agent);
    assert.equal(globals.lumeBrowserBridge, runtime.bridge);

    const open = runtime.control.openUrl("https://example.com", { waitUntil: "domcontentloaded" });
    assert.equal((await respond({ browserId: "extension" })).method, "runtime_ping");
    const createTab = await respond({ tabId: "tab-open" });
    assert.equal(createTab.method, "create_tab");
    assert.deepEqual(createTab.params.options, { url: "https://example.com", active: true });
    assert.equal((await respond(undefined)).method, "playwright_wait_for_load_state");
    assert.equal((await respond({ value: "https://example.com/" })).method, "tab_url");
    assert.equal((await respond({ value: "Example" })).method, "tab_title");
    assert.deepEqual(await open, {
      tabId: "tab-open",
      url: "https://example.com/",
      title: "Example"
    });

    const listTabs = runtime.control.listTabs();
    assert.equal((await respond({ browserId: "extension" })).method, "runtime_ping");
    assert.equal((await respond([{ id: "user-tab-1", url: "https://example.com/" }])).method, "browser_user_open_tabs");
    assert.deepEqual(await listTabs, [{ id: "user-tab-1", url: "https://example.com/" }]);

    const search = runtime.control.search({ engine: "baidu", query: "glm" });
    assert.equal((await respond({ browserId: "extension" })).method, "runtime_ping");
    const searchTab = await respond({ tabId: "tab-search" });
    assert.equal(searchTab.method, "create_tab");
    assert.match(searchTab.params.options.url, /^https:\/\/www\.baidu\.com\/s\?wd=glm$/);
    assert.equal((await respond(undefined)).method, "playwright_wait_for_load_state");
    assert.equal((await respond({ value: "https://www.baidu.com/s?wd=glm" })).method, "tab_url");
    assert.equal((await respond({ value: "glm_百度搜索" })).method, "tab_title");
    assert.deepEqual(await search, {
      tabId: "tab-search",
      url: "https://www.baidu.com/s?wd=glm",
      title: "glm_百度搜索"
    });

    const finalize = runtime.control.finalizeTabs({ keepCurrent: true });
    assert.equal((await respond({ tabId: "tab-search" })).method, "selected_tab");
    assert.equal((await respond(undefined)).method, "finalize_tabs");
    assert.deepEqual(await finalize, { ok: true });

    const status = runtime.control.getStatus();
    assert.equal((await respond({ connected: true })).method, "runtime_diagnostics");
    assert.deepEqual(await status, {
      bridgeUrl: runtime.bridge.url,
      browserSessionId: runtime.context.browserSessionId,
      browserTurnId: runtime.context.browserTurnId,
      connected: true,
      diagnostics: { connected: true }
    });
  } finally {
    client.close();
    await runtime.bridge.close();
  }
});

test("node_repl browser control reports and rejects a disconnected native host without waiting", async () => {
  const { setupNodeReplBrowserRuntime } = await import("../dist/client/setupNodeReplBrowserRuntime.js");
  const runtime = await setupNodeReplBrowserRuntime({
    port: 0,
    globals: {},
    requestTimeoutMs: 200,
  });

  try {
    const status = await runtime.control.getStatus();
    assert.equal(status.connected, false);
    assert.match(status.error, /No Chrome native host connected/);

    const outcome = await Promise.race([
      runtime.control.openUrl("https://example.com").then(
        () => ({ kind: "resolved" }),
        (error) => ({ kind: "rejected", error }),
      ),
      new Promise((resolve) => setTimeout(() => resolve({ kind: "pending" }), 50)),
    ]);

    assert.equal(outcome.kind, "rejected");
    assert.match(outcome.error.message, /No Chrome native host connected/);
  } finally {
    await runtime.bridge.close();
  }
});

test("node_repl browser control closes a newly created tab when openUrl fails", async () => {
  const { setupNodeReplBrowserRuntime } = await import("../dist/client/setupNodeReplBrowserRuntime.js");
  const runtime = await setupNodeReplBrowserRuntime({ port: 0, globals: {} });
  const client = await connectRawWebSocket(runtime.bridge.url);

  try {
    const open = runtime.control.openUrl("https://example.com");
    const rejected = assert.rejects(open, /load timed out/);

    const ping = await client.nextJson();
    client.send({ jsonrpc: "2.0", id: ping.id, result: { browserId: "extension" } });
    const createTab = await client.nextJson();
    client.send({ jsonrpc: "2.0", id: createTab.id, result: { tabId: "tab-failed" } });
    const waitForLoad = await client.nextJson();
    client.send({
      jsonrpc: "2.0",
      id: waitForLoad.id,
      error: { code: "E_LOAD_TIMEOUT", message: "load timed out" },
    });

    const closeTab = await client.nextJson();
    assert.equal(closeTab.method, "close_tab");
    assert.equal(closeTab.params.tabId, "tab-failed");
    client.send({ jsonrpc: "2.0", id: closeTab.id, result: null });

    await rejected;
  } finally {
    client.close();
    await runtime.bridge.close();
  }
});
