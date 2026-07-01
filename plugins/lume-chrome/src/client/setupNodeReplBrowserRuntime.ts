import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { BrowserRegistry, type BrowserTransport } from "./BrowserClient";
import type { BrowserCommandType, BrowserContext, RpcRequest, RpcResponse } from "../shared/protocol";

type ConfirmationDecision = { approved: boolean; remember?: "session" | "always" | "block" };
type JsonRecord = Record<string, unknown>;

export interface BrowserAppServerOptions {
  host?: string;
  port?: number;
  path?: string;
  requestTimeoutMs?: number;
  confirm?: (params: unknown) => Promise<ConfirmationDecision> | ConfirmationDecision;
  onNotification?: (method: string, params: unknown) => void;
}

export interface SetupNodeReplBrowserRuntimeOptions extends BrowserAppServerOptions {
  browserSessionId?: string;
  browserTurnId?: string;
  context?: BrowserContext;
  globals?: Record<string, unknown>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class BrowserAppServer {
  readonly url: string;
  private readonly clients = new Set<WebSocketPeer>();
  private readonly pending = new Map<string, PendingRequest>();
  private seq = 1;

  constructor(
    private readonly server: any,
    private readonly options: Required<Pick<BrowserAppServerOptions, "host" | "path" | "requestTimeoutMs">> &
      Pick<BrowserAppServerOptions, "confirm" | "onNotification">,
    port: number,
  ) {
    this.url = `ws://${options.host}:${port}${options.path}`;
  }

  createTransport(): BrowserTransport {
    return {
      send: <T = unknown>(method: BrowserCommandType, params: unknown) => this.request<T>(method, params),
      notify: (method: string, params: unknown) => this.notify(method, params),
    };
  }

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    const client = await this.waitForClient();
    const id = `lume-browser-${Date.now()}-${this.seq++}`;
    const payload: RpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Browser bridge request timed out: ${method}`));
      }, this.options.requestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      client.send(payload);
    });
  }

  notify(method: string, params: unknown): void {
    const client = this.firstClient();
    if (!client) return;
    client.send({ jsonrpc: "2.0", method, params });
  }

  async close(): Promise<void> {
    for (const client of this.clients) client.close();
    this.clients.clear();
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Browser bridge closed before response: ${id}`));
    }
    this.pending.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  addClient(client: WebSocketPeer): void {
    this.clients.add(client);
    client.onMessage = (message) => void this.handleMessage(client, message);
    client.onClose = () => this.clients.delete(client);
  }

  private async handleMessage(client: WebSocketPeer, message: unknown): Promise<void> {
    if (!isRecord(message)) return;
    if (typeof message.id === "string" && ("result" in message || "error" in message)) {
      this.resolvePending(message as unknown as RpcResponse);
      return;
    }
    if (typeof message.id === "string" && typeof message.method === "string") {
      client.send(await this.handleExtensionRequest(message as unknown as RpcRequest));
      return;
    }
    if (typeof message.method === "string") {
      this.options.onNotification?.(message.method, message.params);
    }
  }

  private resolvePending(message: RpcResponse): void {
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    this.pending.delete(String(message.id));
    clearTimeout(pending.timer);
    if ("error" in message) {
      const error = new Error(message.error.message) as Error & { code?: string; details?: unknown };
      error.code = message.error.code;
      error.details = message.error.details;
      pending.reject(error);
      return;
    }
    pending.resolve(message.result);
  }

  private async handleExtensionRequest(request: RpcRequest): Promise<RpcResponse> {
    try {
      if (request.method === "host.confirmation.request") {
        const result = this.options.confirm
          ? await this.options.confirm(request.params)
          : { approved: true, remember: "session" as const };
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
    } catch (error) {
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

  private async waitForClient(): Promise<WebSocketPeer> {
    const current = this.firstClient();
    if (current) return current;
    const deadline = Date.now() + this.options.requestTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const next = this.firstClient();
      if (next) return next;
    }
    throw new Error(`No Chrome native host connected to ${this.url}`);
  }

  private firstClient(): WebSocketPeer | null {
    return this.clients.values().next().value ?? null;
  }
}

class WebSocketPeer {
  onMessage?: (message: unknown) => void;
  onClose?: () => void;
  private buffer = Buffer.alloc(0);

  constructor(private readonly socket: any) {
    socket.on("data", (chunk: any) => this.handleData(chunk));
    socket.on("close", () => this.onClose?.());
    socket.on("error", () => this.onClose?.());
  }

  send(value: unknown): void {
    const payload = Buffer.from(JSON.stringify(value), "utf8");
    const header = payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]);
    this.socket.write(Buffer.concat([header, payload]));
  }

  close(): void {
    this.socket.destroy();
  }

  private handleData(chunk: any): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const frame = readClientFrame(this.buffer);
      if (!frame) return;
      this.buffer = this.buffer.subarray(frame.bytesRead);
      if (frame.opcode === 0x8) {
        this.close();
        return;
      }
      if (frame.opcode === 0x9) {
        this.socket.write(Buffer.from([0x8a, 0x00]));
        continue;
      }
      if (frame.opcode !== 0x1) continue;
      try {
        this.onMessage?.(JSON.parse(frame.payload.toString("utf8")));
      } catch {
        // Ignore malformed frames; native-host will reconnect if needed.
      }
    }
  }
}

export async function createBrowserAppServer(options: BrowserAppServerOptions = {}): Promise<BrowserAppServer> {
  const host = options.host ?? "127.0.0.1";
  const path = options.path ?? "/browser";
  const requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? 30_000);
  const server = createServer();

  let appServer: BrowserAppServer | null = null;
  server.on("upgrade", (request: any, socket: any) => {
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

  await new Promise<void>((resolve) => server.listen(options.port ?? 43127, host, () => resolve()));
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

export async function setupNodeReplBrowserRuntime(options: SetupNodeReplBrowserRuntimeOptions = {}) {
  const bridge = await createBrowserAppServer(options);
  const context = options.context ?? createDefaultBrowserContext(options);
  const agent = { browsers: new BrowserRegistry(bridge.createTransport(), context) };
  const globals = options.globals ?? globalThis as unknown as Record<string, unknown>;
  globals.agent = agent;
  globals.lumeBrowser = { bridge, context };
  return { agent, bridge, context };
}

function createDefaultBrowserContext(options: SetupNodeReplBrowserRuntimeOptions): BrowserContext {
  const requestMeta = (globalThis as unknown as { nodeRepl?: { requestMeta?: JsonRecord } }).nodeRepl?.requestMeta ?? {};
  const seed = String(requestMeta.sessionId ?? requestMeta.threadId ?? Date.now());
  return {
    browserSessionId: options.browserSessionId ?? `node-repl-${seed}`,
    browserTurnId: options.browserTurnId ?? `turn-${Date.now()}`,
    actor: "agent",
    ...(typeof requestMeta.threadId === "string" ? { threadId: requestMeta.threadId } : {}),
  };
}

function readClientFrame(buffer: any): { opcode: number; payload: any; bytesRead: number } | null {
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    return null;
  }
  if (!masked || buffer.length < offset + 4 + length) return null;
  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) {
    payload[i] = buffer[offset + i] ^ mask[i % 4];
  }
  return { opcode, payload, bytesRead: offset + length };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
