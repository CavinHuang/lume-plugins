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
    hasClient() {
        return this.firstClient() !== null;
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
class BrowserControl {
    transport;
    agent;
    bridge;
    context;
    constructor(transport, agent, bridge, context) {
        this.transport = transport;
        this.agent = agent;
        this.bridge = bridge;
        this.context = context;
    }
    async getStatus() {
        const base = this.statusBase();
        if (!this.bridge.hasClient()) {
            return {
                ...base,
                connected: false,
                error: `No Chrome native host connected to ${this.bridge.url}`,
            };
        }
        try {
            return {
                ...base,
                connected: true,
                diagnostics: await this.agent.browsers.diagnostics(),
            };
        }
        catch (error) {
            return {
                ...base,
                connected: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    async openUrl(url, options = {}) {
        this.assertConnected();
        const browser = await this.agent.browsers.get("extension");
        const tab = await browser.tabs.new(compact({
            url,
            active: options.active ?? true,
            grouped: options.grouped,
        }));
        try {
            await waitForTabLoad(tab, options);
            return await summarizeTab(tab);
        }
        catch (error) {
            await tab.close().catch(() => undefined);
            throw error;
        }
    }
    async search(input, options = {}) {
        const searchOptions = typeof input === "string" ? { ...options, query: input } : input;
        return this.openUrl(buildSearchUrl(searchOptions.engine ?? "baidu", searchOptions.query), searchOptions);
    }
    async listTabs() {
        this.assertConnected();
        const browser = await this.agent.browsers.get("extension");
        return browser.user.openTabs();
    }
    async finalizeTabs(options = {}) {
        this.assertConnected();
        const keep = [];
        const status = options.status ?? "handoff";
        const reason = options.reason ?? "Kept by lumeBrowser.control.finalizeTabs";
        for (const tabId of options.keepTabIds ?? []) {
            keep.push({ tabId, status, reason });
        }
        if (options.keepCurrent) {
            const selected = await this.transport.send("selected_tab", { context: this.context });
            if (selected.tabId && !keep.some((item) => item.tabId === selected.tabId)) {
                keep.push({ tabId: selected.tabId, status, reason });
            }
        }
        await this.transport.send("finalize_tabs", { context: this.context, keep });
        return { ok: true };
    }
    statusBase() {
        return {
            bridgeUrl: this.bridge.url,
            browserSessionId: this.context.browserSessionId,
            browserTurnId: this.context.browserTurnId,
        };
    }
    assertConnected() {
        if (!this.bridge.hasClient()) {
            throw new Error(`No Chrome native host connected to ${this.bridge.url}`);
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
    const globals = options.globals ?? globalThis;
    const existing = globals.lumeBrowser;
    if (isNodeReplBrowserRuntimeState(existing)) {
        const runtime = ensureBrowserControl(existing);
        bindNodeReplBrowserGlobals(globals, runtime);
        return runtime;
    }
    const bridge = await createBrowserAppServer(options);
    const context = options.context ?? createDefaultBrowserContext(options);
    const transport = bridge.createTransport();
    const agent = { browsers: new BrowserRegistry(transport, context) };
    const runtime = { agent, bridge, context, control: new BrowserControl(transport, agent, bridge, context) };
    bindNodeReplBrowserGlobals(globals, runtime);
    return runtime;
}
function ensureBrowserControl(runtime) {
    if (runtime.control)
        return runtime;
    const transport = runtime.bridge.createTransport();
    runtime.control = new BrowserControl(transport, runtime.agent, runtime.bridge, runtime.context);
    return runtime;
}
function bindNodeReplBrowserGlobals(globals, runtime) {
    globals.agent = runtime.agent;
    globals.lumeBrowser = runtime;
    globals.lumeBrowserAgent = runtime.agent;
    globals.lumeBrowserBridge = runtime.bridge;
    globals.lumeBrowserControl = runtime.control;
}
function createDefaultBrowserContext(options) {
    const nodeRepl = globalThis.nodeRepl;
    const requestMeta = nodeRepl?.requestMeta ?? {};
    const explicitSeed = requestMeta.sessionId ?? requestMeta.threadId;
    const fallbackSeed = nodeRepl?.cwd ?? readProcessCwd() ?? "default";
    const seed = explicitSeed === undefined
        ? stableHash(String(fallbackSeed))
        : safeSessionSegment(String(explicitSeed));
    return {
        browserSessionId: options.browserSessionId ?? `node-repl-${seed}`,
        browserTurnId: options.browserTurnId ?? `turn-${Date.now()}`,
        actor: "agent",
        ...(typeof requestMeta.threadId === "string" ? { threadId: requestMeta.threadId } : {}),
    };
}
function stableHash(value) {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
function safeSessionSegment(value) {
    return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96) || "default";
}
function readProcessCwd() {
    try {
        const processLike = globalThis.process;
        return typeof processLike?.cwd === "function" ? processLike.cwd() : null;
    }
    catch {
        return null;
    }
}
function buildSearchUrl(engine, query) {
    const encoded = encodeURIComponent(query);
    switch (engine) {
        case "google":
            return `https://www.google.com/search?q=${encoded}`;
        case "bing":
            return `https://www.bing.com/search?q=${encoded}`;
        case "baidu":
        default:
            return `https://www.baidu.com/s?wd=${encoded}`;
    }
}
async function waitForTabLoad(tab, options) {
    await tab.playwright.waitForLoadState({
        state: options.waitUntil === "commit" ? "domcontentloaded" : options.waitUntil ?? "load",
        timeoutMs: options.timeoutMs,
    });
}
async function summarizeTab(tab) {
    const [url, title] = await Promise.all([
        tab.url().then(readMaybeValue),
        tab.title().then(readMaybeValue),
    ]);
    return compact({ tabId: tab.id, url, title });
}
function readMaybeValue(value) {
    if (isRecord(value) && "value" in value)
        return value.value;
    return value;
}
function compact(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
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
function isNodeReplBrowserRuntimeState(value) {
    if (!isRecord(value))
        return false;
    const bridge = value.bridge;
    const context = value.context;
    const agent = value.agent;
    return !!bridge
        && typeof bridge.createTransport === "function"
        && typeof bridge.close === "function"
        && !!context?.browserSessionId
        && !!context?.browserTurnId
        && !!agent?.browsers;
}
