import assert from "node:assert/strict";
import test from "node:test";

test("native transport increments generation after every successful connection", async () => {
  const disconnectListeners = [];
  globalThis.chrome = {
    alarms: { create() {}, onAlarm: { addListener() {} } },
    runtime: {
      id: "test-extension",
      lastError: undefined,
      getManifest: () => ({ version: "0.4.0" }),
      connectNative: () => ({
        onMessage: { addListener() {} },
        onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
        postMessage() {},
      }),
    },
    storage: { local: { async set() {} } },
  };

  try {
    const { NativeTransport } = await import("../dist/extension/runtime/NativeTransport.js");
    const transport = new NativeTransport(async () => ({
      jsonrpc: "2.0",
      id: "1",
      result: null,
    }));

    assert.equal(transport.connectionGeneration(), 0);
    transport.connect();
    assert.equal(transport.connectionGeneration(), 1);
    disconnectListeners.shift()();
    transport.connect();
    assert.equal(transport.connectionGeneration(), 2);
    disconnectListeners.shift()();
  } finally {
    delete globalThis.chrome;
  }
});

test("native transport reconnect delay backs off and stays capped", async () => {
  const { nativeReconnectDelayMinutes } = await import("../dist/extension/runtime/NativeTransport.js");
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 99].map(nativeReconnectDelayMinutes),
    [0.1, 0.5, 1, 2, 5, 5, 5],
  );
});
