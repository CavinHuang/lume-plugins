import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { BrowserRegistry, type BrowserTransport, type Tab } from "./BrowserClient";
import type {
  BrowserCommandType,
  BrowserContext,
  FinalizeTabKeep,
  RpcRequest,
  RpcResponse,
  UserTabInfo
} from "../shared/protocol";

type ConfirmationDecision = { approved: boolean; remember?: "session" | "always" | "block" };
type BrowserAuthCredentialResponse = {
  status: "approved" | "declined" | "cancelled" | "unavailable" | "expired" | "origin_changed" | "page_changed" | "locator_invalid" | "submission_failed";
  values?: Record<string, string>;
};
type JsonRecord = Record<string, unknown>;

export interface BrowserAppServerOptions {
  host?: string;
  port?: number;
  path?: string;
  requestTimeoutMs?: number;
  confirm?: (params: unknown) => Promise<ConfirmationDecision> | ConfirmationDecision;
  browserAuth?: (params: unknown) => Promise<BrowserAuthCredentialResponse> | BrowserAuthCredentialResponse;
  onNotification?: (method: string, params: unknown) => void;
}

export interface SetupNodeReplBrowserRuntimeOptions extends BrowserAppServerOptions {
  browserSessionId?: string;
  browserTurnId?: string;
  context?: BrowserContext;
  globals?: Record<string, unknown>;
}

interface NodeReplBrowserRuntimeState {
  agent: { browsers: BrowserRegistry };
  bridge: BrowserAppServer;
  context: BrowserContext;
  control: NodeReplBrowserControl;
}

export interface BrowserControlOpenOptions {
  active?: boolean;
  grouped?: boolean;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  timeoutMs?: number;
}

export interface BrowserControlSearchOptions extends BrowserControlOpenOptions {
  engine?: "baidu" | "bing" | "google";
  query: string;
}

export interface BrowserControlTabResult {
  tabId: string;
  url?: string;
  title?: string;
}

export interface BrowserControlFinalizeOptions {
  keepCurrent?: boolean;
  keepTabIds?: string[];
  status?: FinalizeTabKeep["status"];
  reason?: string;
}

export interface BrowserControlStatus {
  bridgeUrl: string;
  browserSessionId: string;
  browserTurnId: string;
  connected: boolean;
  diagnostics?: unknown;
  error?: string;
}

export interface NodeReplBrowserControl {
  getStatus(): Promise<BrowserControlStatus>;
  openUrl(url: string, options?: BrowserControlOpenOptions): Promise<BrowserControlTabResult>;
  search(query: string, options?: Omit<BrowserControlSearchOptions, "query">): Promise<BrowserControlTabResult>;
  search(options: BrowserControlSearchOptions): Promise<BrowserControlTabResult>;
  listTabs(): Promise<UserTabInfo[]>;
  finalizeTabs(options?: BrowserControlFinalizeOptions): Promise<{ ok: true }>;
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
      Pick<BrowserAppServerOptions, "confirm" | "browserAuth" | "onNotification">,
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

  hasClient(): boolean {
    return this.firstClient() !== null;
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
      if (request.method === "host.browserAuth.request") {
        const result = this.options.browserAuth
          ? await this.options.browserAuth(request.params)
          : { status: "unavailable" as const };
        return { jsonrpc: "2.0", id: request.id, result: normalizeBrowserAuthCredentialResponse(result) };
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

class BrowserControl implements NodeReplBrowserControl {
  constructor(
    private readonly transport: BrowserTransport,
    private readonly agent: { browsers: BrowserRegistry },
    private readonly bridge: BrowserAppServer,
    private readonly context: BrowserContext,
  ) {}

  async getStatus(): Promise<BrowserControlStatus> {
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
    } catch (error) {
      return {
        ...base,
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async openUrl(url: string, options: BrowserControlOpenOptions = {}): Promise<BrowserControlTabResult> {
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
    } catch (error) {
      await tab.close().catch(() => undefined);
      throw error;
    }
  }

  async search(
    input: string | BrowserControlSearchOptions,
    options: Omit<BrowserControlSearchOptions, "query"> = {},
  ): Promise<BrowserControlTabResult> {
    const searchOptions = typeof input === "string" ? { ...options, query: input } : input;
    return this.openUrl(buildSearchUrl(searchOptions.engine ?? "baidu", searchOptions.query), searchOptions);
  }

  async listTabs(): Promise<UserTabInfo[]> {
    this.assertConnected();
    const browser = await this.agent.browsers.get("extension");
    return browser.user.openTabs();
  }

  async finalizeTabs(options: BrowserControlFinalizeOptions = {}): Promise<{ ok: true }> {
    this.assertConnected();
    const keep: FinalizeTabKeep[] = [];
    const status = options.status ?? "handoff";
    const reason = options.reason ?? "Kept by lumeBrowser.control.finalizeTabs";

    for (const tabId of options.keepTabIds ?? []) {
      keep.push({ tabId, status, reason });
    }

    if (options.keepCurrent) {
      const selected = await this.transport.send<{ tabId?: string }>("selected_tab", { context: this.context });
      if (selected.tabId && !keep.some((item) => item.tabId === selected.tabId)) {
        keep.push({ tabId: selected.tabId, status, reason });
      }
    }

    await this.transport.send("finalize_tabs", { context: this.context, keep });
    return { ok: true };
  }

  private statusBase(): Omit<BrowserControlStatus, "connected"> {
    return {
      bridgeUrl: this.bridge.url,
      browserSessionId: this.context.browserSessionId,
      browserTurnId: this.context.browserTurnId,
    };
  }

  private assertConnected(): void {
    if (!this.bridge.hasClient()) {
      throw new Error(`No Chrome native host connected to ${this.bridge.url}`);
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
    browserAuth: options.browserAuth,
    onNotification: options.onNotification,
  }, port);
  return appServer;
}

export async function setupNodeReplBrowserRuntime(options: SetupNodeReplBrowserRuntimeOptions = {}) {
  const globals = options.globals ?? globalThis as unknown as Record<string, unknown>;
  const existing = globals.lumeBrowser;
  if (isNodeReplBrowserRuntimeState(existing)) {
    const runtime = ensureBrowserControl(existing);
    bindNodeReplBrowserGlobals(globals, runtime);
    return runtime;
  }

  const bridge = await createBrowserAppServer({
    ...options,
    browserAuth: options.browserAuth ?? resolveNodeReplBrowserAuth(globals),
  });
  const context = options.context ?? createDefaultBrowserContext(options);
  const transport = bridge.createTransport();
  const agent = { browsers: new BrowserRegistry(transport, context) };
  const runtime = { agent, bridge, context, control: new BrowserControl(transport, agent, bridge, context) };
  bindNodeReplBrowserGlobals(globals, runtime);
  return runtime;
}

function ensureBrowserControl(runtime: NodeReplBrowserRuntimeState): NodeReplBrowserRuntimeState {
  if (runtime.control) return runtime;
  const transport = runtime.bridge.createTransport();
  runtime.control = new BrowserControl(transport, runtime.agent, runtime.bridge, runtime.context);
  return runtime;
}

function bindNodeReplBrowserGlobals(globals: Record<string, unknown>, runtime: NodeReplBrowserRuntimeState): void {
  globals.agent = runtime.agent;
  globals.lumeBrowser = runtime;
  globals.lumeBrowserAgent = runtime.agent;
  globals.lumeBrowserBridge = runtime.bridge;
  globals.lumeBrowserControl = runtime.control;
}

function createDefaultBrowserContext(options: SetupNodeReplBrowserRuntimeOptions): BrowserContext {
  const nodeRepl = (globalThis as unknown as { nodeRepl?: { cwd?: string; requestMeta?: JsonRecord } }).nodeRepl;
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

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function safeSessionSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96) || "default";
}

function readProcessCwd(): string | null {
  try {
    const processLike = (globalThis as unknown as { process?: { cwd?: () => string } }).process;
    return typeof processLike?.cwd === "function" ? processLike.cwd() : null;
  } catch {
    return null;
  }
}

function resolveNodeReplBrowserAuth(
  globals: Record<string, unknown>,
): BrowserAppServerOptions["browserAuth"] | undefined {
  const nodeRepl = globals.nodeRepl as { browserAuth?: { request?: unknown } } | undefined;
  const request = nodeRepl?.browserAuth?.request;
  return typeof request === "function"
    ? (params) => request.call(nodeRepl.browserAuth, params) as Promise<BrowserAuthCredentialResponse> | BrowserAuthCredentialResponse
    : undefined;
}

function normalizeBrowserAuthCredentialResponse(value: unknown): BrowserAuthCredentialResponse {
  const input = value as Partial<BrowserAuthCredentialResponse> | undefined;
  if (!input || typeof input.status !== "string") return { status: "unavailable" };
  if (input.status === "approved") {
    return { status: "approved", values: sanitizeBrowserAuthValues(input.values) };
  }
  if (
    input.status === "declined"
    || input.status === "cancelled"
    || input.status === "unavailable"
    || input.status === "expired"
    || input.status === "origin_changed"
    || input.status === "page_changed"
    || input.status === "locator_invalid"
    || input.status === "submission_failed"
  ) {
    return { status: input.status };
  }
  return { status: "unavailable" };
}

function sanitizeBrowserAuthValues(values: unknown): Record<string, string> {
  if (!isRecord(values)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function buildSearchUrl(engine: BrowserControlSearchOptions["engine"], query: string): string {
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

async function waitForTabLoad(tab: Tab, options: BrowserControlOpenOptions): Promise<void> {
  await tab.playwright.waitForLoadState({
    state: options.waitUntil === "commit" ? "domcontentloaded" : options.waitUntil ?? "load",
    timeoutMs: options.timeoutMs,
  });
}

async function summarizeTab(tab: Tab): Promise<BrowserControlTabResult> {
  const [url, title] = await Promise.all([
    tab.url().then(readMaybeValue),
    tab.title().then(readMaybeValue),
  ]);
  return compact({ tabId: tab.id, url, title });
}

function readMaybeValue<T>(value: T | { value?: T } | undefined): T | undefined {
  if (isRecord(value) && "value" in value) return value.value as T | undefined;
  return value as T | undefined;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
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

function isNodeReplBrowserRuntimeState(value: unknown): value is NodeReplBrowserRuntimeState {
  if (!isRecord(value)) return false;
  const bridge = value.bridge as { createTransport?: unknown; close?: unknown } | undefined;
  const context = value.context as BrowserContext | undefined;
  const agent = value.agent as { browsers?: unknown } | undefined;
  return !!bridge
    && typeof bridge.createTransport === "function"
    && typeof bridge.close === "function"
    && !!context?.browserSessionId
    && !!context?.browserTurnId
    && !!agent?.browsers;
}
