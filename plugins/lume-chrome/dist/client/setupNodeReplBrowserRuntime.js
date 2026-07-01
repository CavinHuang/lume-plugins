import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { BrowserRegistry } from "./BrowserClient.js";
class BrowserAppServer {
    server;
    options;
    url;
    clients = new Set();
    pending = new Map();
    seq = 1;
    constructor(server, options, port) {
        this.server = server;
        this.options = options;
        this.url = `ws://${options.host}:${port}${options.path}`;
    }
    createTransport() {
        return {
            send: (method, params) => this.request(method, params),
            notify: (method, params) => this.notify(method, params),
        };
    }
    async request(method, params) {
        const client = await this.waitForClient();
        const id = `lume-browser-${Date.now()}-${this.seq++}`;
        const payload = { jsonrpc: "2.0", id, method, params };
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Browser bridge request timed out: ${method}`));
            }, this.options.requestTimeoutMs);
            this.pending.set(id, { resolve: resolve, reject, timer });
            client.send(payload);
        });
    }
    notify(method, params) {
        const client = this.firstClient();
        if (!client)
            return;
        client.send({ jsonrpc: "2.0", method, params });
    }
    async close() {
        for (const client of this.clients)
            client.close();
        this.clients.clear();
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error(`Browser bridge closed before response: ${id}`));
        }
        this.pending.clear();
        await new Promise((resolve) => this.server.close(() => resolve()));
    }
    addClient(client) {
        this.clients.add(client);
        client.onMessage = (message) => void this.handleMessage(client, message);
        client.onClose = () => this.clients.delete(client);
    }
    async handleMessage(client, message) {
        if (!isRecord(message))
            return;
        if (typeof message.id === "string" && ("result" in message || "error" in message)) {
            this.resolvePending(message);
            return;
        }
        if (typeof message.id === "string" && typeof message.method === "string") {
            client.send(await this.handleExtensionRequest(message));
            return;
        }
        if (typeof message.method === "string") {
            this.options.onNotification?.(message.method, message.params);
        }
    }
    resolvePending(message) {
        const pending = this.pending.get(String(message.id));
        if (!pending)
            return;
        this.pending.delete(String(message.id));
        clearTimeout(pending.timer);
        if ("error" in message) {
            const error = new Error(message.error.message);
            error.code = message.error.code;
            error.details = message.error.details;
            pending.reject(error);
            return;
        }
        pending.resolve(message.result);
    }
    async handleExtensionRequest(request) {
        try {
            if (request.method === "host.confirmation.request") {
                const result = this.options.confirm
                    ? await this.options.confirm(request.params)
                    : { approved: true, remember: "session" };
                return { jsonrpc: "2.0", id: request.id, result };
            }
            return {
                jsonrpc: "2.0",
                id: request.id,
                error: {
                    code: "E_APP_SERVER_UNSUPPORTED",
                    message: `Unsupported extension request: ${request.method}`,
                    recoverable: true,
                },
            };
        }
        catch (error) {
            return {
                jsonrpc: "2.0",
                id: request.id,
                error: {
                    code: "E_APP_SERVER_REQUEST_FAILED",
                    message: error instanceof Error ? error.message : String(error),
                    recoverable: true,
                },
            };
        }
    }
    async waitForClient() {
        const current = this.firstClient();
        if (current)
            return current;
        const deadline = Date.now() + this.options.requestTimeoutMs;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            const next = this.firstClient();
            if (next)
                return next;
        }
        throw new Error(`No Chrome native host connected to ${this.url}`);
    }
    firstClient() {
        return this.clients.values().next().value ?? null;
    }
}
class WebSocketPeer {
    socket;
    onMessage;
    onClose;
    buffer = Buffer.alloc(0);
    constructor(socket) {
        this.socket = socket;
        socket.on("data", (chunk) => this.handleData(chunk));
        socket.on("close", () => this.onClose?.());
        socket.on("error", () => this.onClose?.());
    }
    send(value) {
        const payload = Buffer.from(JSON.stringify(value), "utf8");
        const header = payload.length < 126
            ? Buffer.from([0x81, payload.length])
            : Buffer.from([0x81, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]);
        this.socket.write(Buffer.concat([header, payload]));
    }
    close() {
        this.socket.destroy();
    }
    handleData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 2) {
            const frame = readClientFrame(this.buffer);
            if (!frame)
                return;
            this.buffer = this.buffer.subarray(frame.bytesRead);
            if (frame.opcode === 0x8) {
                this.close();
                return;
            }
            if (frame.opcode === 0x9) {
                this.socket.write(Buffer.from([0x8a, 0x00]));
                continue;
            }
            if (frame.opcode !== 0x1)
                continue;
            try {
                this.onMessage?.(JSON.parse(frame.payload.toString("utf8")));
            }
            catch {
                // Ignore malformed frames; native-host will reconnect if needed.
            }
        }
    }
}
export async function createBrowserAppServer(options = {}) {
    const host = options.host ?? "127.0.0.1";
    const path = options.path ?? "/browser";
    const requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? 30_000);
    const server = createServer();
    let appServer = null;
    server.on("upgrade", (request, socket) => {
        if (request.url !== path) {
            socket.destroy();
            return;
        }
        const key = request.headers["sec-websocket-key"];
        if (typeof key !== "string") {
            socket.destroy();
            return;
        }
        const accept = createHash("sha1")
            .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
            .digest("base64");
        socket.write([
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Accept: ${accept}`,
            "\r\n",
        ].join("\r\n"));
        appServer?.addClient(new WebSocketPeer(socket));
    });
    await new Promise((resolve) => server.listen(options.port ?? 43127, host, () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : options.port ?? 43127;
    appServer = new BrowserAppServer(server, {
        host,
        path,
        requestTimeoutMs,
        confirm: options.confirm,
        onNotification: options.onNotification,
    }, port);
    return appServer;
}
export async function setupNodeReplBrowserRuntime(options = {}) {
    const bridge = await createBrowserAppServer(options);
    const context = options.context ?? createDefaultBrowserContext(options);
    const agent = { browsers: new BrowserRegistry(bridge.createTransport(), context) };
    const globals = options.globals ?? globalThis;
    globals.agent = agent;
    globals.lumeBrowser = { bridge, context };
    return { agent, bridge, context };
}
function createDefaultBrowserContext(options) {
    const requestMeta = globalThis.nodeRepl?.requestMeta ?? {};
    const seed = String(requestMeta.sessionId ?? requestMeta.threadId ?? Date.now());
    return {
        browserSessionId: options.browserSessionId ?? `node-repl-${seed}`,
        browserTurnId: options.browserTurnId ?? `turn-${Date.now()}`,
        actor: "agent",
        ...(typeof requestMeta.threadId === "string" ? { threadId: requestMeta.threadId } : {}),
    };
}
function readClientFrame(buffer) {
    const first = buffer[0];
    const second = buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
        if (buffer.length < 4)
            return null;
        length = buffer.readUInt16BE(2);
        offset = 4;
    }
    else if (length === 127) {
        return null;
    }
    if (!masked || buffer.length < offset + 4 + length)
        return null;
    const mask = buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.alloc(length);
    for (let i = 0; i < length; i += 1) {
        payload[i] = buffer[offset + i] ^ mask[i % 4];
    }
    return { opcode, payload, bytesRead: offset + length };
}
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
