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
