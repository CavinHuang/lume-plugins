import type {
  BrowserCapabilities, BrowserCommandType, BrowserContext, DiagnosticsReport, DomSnapshot,
  DownloadInfo, FileChooserInfo, FinalizeTabKeep, LocatorPayload, RpcRequest, RpcResponse,
  SessionTabInfo, SitePermissionRecord, UserTabInfo, VisibleDomNode
} from "../shared/protocol";
import { appendLocator, locatorAst, type LocatorAst, type LocatorStep, type TextMatcher } from "../shared/locator";
import { disabledMembersFor, type ApiSupportOverrides } from "./api-contract";
import { CapabilityCollection, createCapabilityDefinitions } from "./capabilities";
import {
  BrowserDocumentation,
  formatApiReference,
  type ReadDocument,
} from "./documentation";

const CAPABILITY_DEFINITIONS = createCapabilityDefinitions();
const EMPTY_DOCUMENT_READER: ReadDocument = async () => "";

export interface BrowserTransport {
  send<T = unknown>(method: BrowserCommandType, params: unknown): Promise<T>;
  notify?(method: string, params: unknown): void;
}

export class JsonRpcTransport implements BrowserTransport {
  private seq = 1;
  constructor(private readonly post: (message: RpcRequest) => Promise<RpcResponse>) {}
  async send<T>(method: BrowserCommandType, params: unknown): Promise<T> {
    const id = String(this.seq++);
    const response = await this.post({ jsonrpc: "2.0", id, method, params });
    if ("error" in response) {
      const err = new Error(response.error.message) as Error & { code?: string; details?: unknown; recoverable?: boolean };
      err.code = response.error.code;
      err.details = response.error.details;
      err.recoverable = response.error.recoverable;
      throw err;
    }
    return response.result as T;
  }
}

export class BrowserRegistry {
  constructor(
    private readonly transport: BrowserTransport,
    private readonly context: BrowserContext,
    private readonly readDocument: ReadDocument = EMPTY_DOCUMENT_READER,
  ) {}
  async get(id: "extension" | "iab" | "cdp" | string = "extension"): Promise<Browser> {
    const caps = await this.transport.send<BrowserCapabilities>("runtime_ping", { clientType: id, context: this.context });
    const disabledMembers = disabledMembersFor(
      caps.type,
      caps.apiSupportOverrides as ApiSupportOverrides,
    );
    const documentation = new BrowserDocumentation({
      api: async () => formatApiReference(disabledMembers),
      browserType: caps.type,
      capabilities: caps.capabilities,
      disabledMembers,
      read: this.readDocument,
    });
    return new Browser(this.transport, this.context, caps, documentation);
  }
  list(): Promise<BrowserCapabilities[]> {
    return this.transport.send("runtime_list_browsers", { context: this.context });
  }
  diagnostics(): Promise<DiagnosticsReport> {
    return this.transport.send("runtime_diagnostics", { context: this.context });
  }
}

export class Browser {
  readonly browserId: string;
  readonly user: BrowserUser;
  readonly tabs: Tabs;
  readonly capabilities: CapabilityCollection;
  constructor(
    private readonly t: BrowserTransport,
    private readonly ctx: BrowserContext,
    public readonly info: BrowserCapabilities,
    private readonly docs: BrowserDocumentation,
  ) {
    this.browserId = info.browserId;
    this.user = new BrowserUser(t, ctx, info);
    this.tabs = new Tabs(t, ctx, info);
    this.capabilities = new CapabilityCollection({
      advertised: info.capabilities.browser,
      browserId: info.browserId,
      definitions: CAPABILITY_DEFINITIONS,
      scope: "browser",
      transport: t,
    });
  }
  async documentation(): Promise<string> {
    const [guidance, api] = await Promise.all([this.docs.guidance(), this.docs.api()]);
    return [guidance, api, this.docs.lookupCatalog()]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join("\n\n");
  }
  nameSession(name: string): Promise<void> { return this.t.send("browser_name_session", { context: this.ctx, name }); }
  sitePermissions = {
    list: () => this.t.send<SitePermissionRecord[]>("browser_site_permissions_list", { context: this.ctx }),
    allowForSession: (host: string) => this.t.send<void>("browser_site_permission_set", { context: this.ctx, host, decision: "allow_session" }),
    alwaysAllow: (host: string) => this.t.send<void>("browser_site_permission_set", { context: this.ctx, host, decision: "allow_always" }),
    block: (host: string) => this.t.send<void>("browser_site_permission_set", { context: this.ctx, host, decision: "block" }),
    clear: (host: string) => this.t.send<void>("browser_site_permission_clear", { context: this.ctx, host })
  };
}

export class BrowserUser {
  constructor(
    private readonly t: BrowserTransport,
    private readonly ctx: BrowserContext,
    private readonly browser: BrowserCapabilities,
  ) {}
  openTabs(): Promise<UserTabInfo[]> { return this.t.send("browser_user_open_tabs", { context: this.ctx }); }
  async claimTab(tab: UserTabInfo | string): Promise<Tab> {
    const tabId = typeof tab === "string" ? tab : tab.id;
    const result = await this.t.send<{ tabId: string }>("browser_user_claim_tab", { context: this.ctx, tabId });
    return new Tab(this.t, this.ctx, result.tabId, this.browser);
  }
  history(options: { text?: string; maxResults?: number; startTime?: number; endTime?: number } = {}): Promise<Array<{url:string; title?:string; lastVisitTime?:number}>> {
    return this.t.send("browser_user_history", { context: this.ctx, options });
  }
  topSites(): Promise<Array<{url:string; title?:string}>> { return this.t.send("top_sites_get", { context: this.ctx }); }
  recentSessions(): Promise<unknown[]> { return this.t.send("sessions_get_recently_closed", { context: this.ctx }); }
}

export class Tabs {
  constructor(
    private readonly t: BrowserTransport,
    private readonly ctx: BrowserContext,
    private readonly browser: BrowserCapabilities,
  ) {}
  async new(options: { url?: string; active?: boolean; grouped?: boolean } = {}): Promise<Tab> {
    const r = await this.t.send<{tabId:string}>("create_tab", { context: this.ctx, options });
    return new Tab(this.t, this.ctx, r.tabId, this.browser);
  }
  async get(id: string): Promise<Tab> {
    const r = await this.t.send<{tabId:string}>("get_tab", { context: this.ctx, tabId: id });
    return new Tab(this.t, this.ctx, r.tabId, this.browser);
  }
  async selected(): Promise<Tab | undefined> {
    const r = await this.t.send<{tabId?:string}>("selected_tab", { context: this.ctx });
    return r.tabId ? new Tab(this.t, this.ctx, r.tabId, this.browser) : undefined;
  }
  list(): Promise<SessionTabInfo[]> { return this.t.send("list_tabs", { context: this.ctx }); }
  sessionTabs(): Promise<SessionTabInfo[]> { return this.t.send("get_session_tabs", { context: this.ctx }); }
  finalize(options: { keep?: FinalizeTabKeep[] } = {}): Promise<void> { return this.t.send("finalize_tabs", { context: this.ctx, keep: options.keep ?? [] }); }
  release(tabIds: string[]): Promise<void> { return this.t.send("release_tabs", { context: this.ctx, tabIds }); }
  handoff(tabIds: string[]): Promise<void> { return this.t.send("handoff_tabs", { context: this.ctx, tabIds }); }
  resumeHandoff(): Promise<Tab[]> {
    return this.t.send<Array<{tabId:string}>>("resume_handoff_tabs", { context: this.ctx })
      .then(xs => xs.map(x => new Tab(this.t, this.ctx, x.tabId, this.browser)));
  }
}

export class Tab {
  readonly cua: CUAAPI;
  readonly dom_cua: DomCUAAPI;
  readonly playwright: PlaywrightAPI;
  readonly capabilities: CapabilityCollection;
  readonly clipboard: ClipboardAPI;
  readonly dev: TabDevAPI;
  constructor(
    private readonly t: BrowserTransport,
    private readonly ctx: BrowserContext,
    public readonly id: string,
    browser: BrowserCapabilities,
  ) {
    this.cua = new CUAAPI(t, ctx, id);
    this.dom_cua = new DomCUAAPI(t, ctx, id);
    this.playwright = new PlaywrightAPI(t, ctx, id);
    this.capabilities = new CapabilityCollection({
      advertised: browser.capabilities.tab,
      browserId: browser.browserId,
      definitions: CAPABILITY_DEFINITIONS,
      scope: "tab",
      tabId: id,
      transport: t,
    });
    this.clipboard = new ClipboardAPI(t, ctx, id);
    this.dev = new TabDevAPI(t, ctx, id);
  }
  close(): Promise<void> { return this.t.send("close_tab", { context: this.ctx, tabId: this.id }); }
  title(): Promise<string | undefined> { return this.t.send("tab_title", { context: this.ctx, tabId: this.id }); }
  url(): Promise<string | undefined> { return this.t.send("tab_url", { context: this.ctx, tabId: this.id }); }
  goto(url: string, options: { waitUntil?: "load"|"domcontentloaded"|"networkidle"|"commit"; timeoutMs?: number } = {}): Promise<void> {
    return this.t.send("navigate_tab_url", { context: this.ctx, tabId: this.id, url, options });
  }
  back(): Promise<void> { return this.t.send("navigate_tab_back", { context: this.ctx, tabId: this.id }); }
  forward(): Promise<void> { return this.t.send("navigate_tab_forward", { context: this.ctx, tabId: this.id }); }
  reload(): Promise<void> { return this.t.send("navigate_tab_reload", { context: this.ctx, tabId: this.id }); }
  screenshot(options: { fullPage?: boolean; format?: "png" | "jpeg"; quality?: number; clip?: {x:number;y:number;width:number;height:number} } = {}): Promise<Uint8Array> {
    return this.t.send<{ dataBase64: string }>("tab_screenshot", { context: this.ctx, tabId: this.id, options })
      .then((result) => Uint8Array.from(atob(result.dataBase64), c => c.charCodeAt(0)));
  }
  exportContent(options: { format: "text" | "markdown" | "html" | "gsuite" }): Promise<{ assetId: string; path?: string }> {
    return this.t.send(options.format === "gsuite" ? "tab_content_export_gsuite" : "tab_content_export", { context: this.ctx, tabId: this.id, options });
  }
}

class TabDevAPI {
  constructor(private readonly t: BrowserTransport, private readonly ctx: BrowserContext, private readonly tabId: string) {}
  cdpCall(method: string, params?: Record<string, unknown>, allowMutating = false): Promise<unknown> {
    return this.t.send("tab_cdp_call", { context: this.ctx, tabId: this.tabId, method, params, allowMutating });
  }
  subscribe(events: string[]): Promise<void> { return this.t.send("tab_cdp_events", { context: this.ctx, tabId: this.tabId, events }); }
  logs(): Promise<unknown[]> { return this.t.send("tab_dev_logs", { context: this.ctx, tabId: this.tabId }); }
}

class CUAAPI {
  constructor(private readonly t: BrowserTransport, private readonly ctx: BrowserContext, private readonly tabId: string) {}
  click(options:{x:number;y:number}): Promise<void> { return this.t.send("cua_click", { context:this.ctx, tabId:this.tabId, ...options }); }
  double_click(options:{x:number;y:number}): Promise<void> { return this.t.send("cua_double_click", { context:this.ctx, tabId:this.tabId, ...options }); }
  move(options:{x:number;y:number}): Promise<void> { return this.t.send("cua_move", { context:this.ctx, tabId:this.tabId, ...options }); }
  drag(options:{path:Array<{x:number;y:number}>}): Promise<void> { return this.t.send("cua_drag", { context:this.ctx, tabId:this.tabId, ...options }); }
  scroll(options:{x:number;y:number;scrollX?:number;scrollY?:number}): Promise<void> { return this.t.send("cua_scroll", { context:this.ctx, tabId:this.tabId, ...options }); }
  type(options:{text:string}): Promise<void> { return this.t.send("cua_type", { context:this.ctx, tabId:this.tabId, ...options }); }
  keypress(options:{key:string}): Promise<void> { return this.t.send("cua_keypress", { context:this.ctx, tabId:this.tabId, ...options }); }
  downloadMedia(options:{x:number;y:number}): Promise<{downloadId?:number}> { return this.t.send("cua_download_media", { context:this.ctx, tabId:this.tabId, ...options }); }
}

class DomCUAAPI {
  constructor(private readonly t: BrowserTransport, private readonly ctx: BrowserContext, private readonly tabId: string) {}
  get_visible_dom(): Promise<VisibleDomNode[]> { return this.t.send("dom_cua_get_visible_dom", { context:this.ctx, tabId:this.tabId }); }
  click(options:{node_id:string}): Promise<void> { return this.t.send("dom_cua_click", { context:this.ctx, tabId:this.tabId, ...options }); }
  double_click(options:{node_id:string}): Promise<void> { return this.t.send("dom_cua_double_click", { context:this.ctx, tabId:this.tabId, ...options }); }
  type(options:{node_id:string;text:string}): Promise<void> { return this.t.send("dom_cua_type", { context:this.ctx, tabId:this.tabId, ...options }); }
  keypress(options:{node_id:string;key:string}): Promise<void> { return this.t.send("dom_cua_keypress", { context:this.ctx, tabId:this.tabId, ...options }); }
  scroll(options:{node_id?:string;deltaX?:number;deltaY?:number}): Promise<void> { return this.t.send("dom_cua_scroll", { context:this.ctx, tabId:this.tabId, ...options }); }
  downloadMedia(options:{node_id:string}): Promise<{downloadId?:number}> { return this.t.send("dom_cua_download_media", { context:this.ctx, tabId:this.tabId, ...options }); }
}

export class PlaywrightAPI {
  constructor(private readonly t: BrowserTransport, private readonly ctx: BrowserContext, private readonly tabId: string, private readonly frameSteps: LocatorStep[] = []) {}
  domSnapshot(): Promise<DomSnapshot> { return this.t.send("playwright_dom_snapshot", { context:this.ctx, tabId:this.tabId }); }
  evaluate<TResult = unknown, TArg = unknown>(expression: string, arg?: TArg): Promise<TResult> {
    return this.t.send("playwright_evaluate", { context:this.ctx, tabId:this.tabId, expression, arg });
  }
  async expectNavigation<T>(action: () => Promise<T>, options: { timeoutMs?: number; url?: string; waitUntil?: "load"|"domcontentloaded"|"networkidle"|"commit" } = {}): Promise<T> {
    const result = await action();
    if (options.url) await this.waitForURL(options.url, { timeoutMs: options.timeoutMs });
    else await this.waitForLoadState({ state: options.waitUntil === "commit" ? "domcontentloaded" : options.waitUntil ?? "load", timeoutMs: options.timeoutMs });
    return result;
  }
  frameLocator(frameSelector: string): PlaywrightAPI { return new PlaywrightAPI(this.t, this.ctx, this.tabId, [...this.frameSteps, { kind:"frame", selector:frameSelector }]); }
  locator(selector:string): Locator { return this.make({ kind:"locator", selector }); }
  getByRole(role:string, options:{name?:TextMatcher;exact?:boolean}={}): Locator { return this.make({ kind:"role", role, ...options }); }
  getByText(text:TextMatcher, options:{exact?:boolean}={}): Locator { return this.make({ kind:"text", text, ...options }); }
  getByLabel(text:TextMatcher, options:{exact?:boolean}={}): Locator { return this.make({ kind:"label", text, ...options }); }
  getByPlaceholder(text:TextMatcher, options:{exact?:boolean}={}): Locator { return this.make({ kind:"placeholder", text, ...options }); }
  getByTestId(testId:string): Locator { return this.make({ kind:"testId", testId }); }
  waitForURL(url:string, options:{timeoutMs?:number}={}): Promise<void> { return this.t.send("playwright_wait_for_url", { context:this.ctx, tabId:this.tabId, url, options }); }
  waitForLoadState(options:{state?:"load"|"domcontentloaded"|"networkidle";timeoutMs?:number}={}): Promise<void> { return this.t.send("playwright_wait_for_load_state", { context:this.ctx, tabId:this.tabId, ...options }); }
  waitForTimeout(timeoutMs:number): Promise<void> { return this.t.send("playwright_wait_for_timeout", { context:this.ctx, tabId:this.tabId, timeoutMs }); }
  async waitForEvent(event:"download"|"filechooser", options:{timeoutMs?:number}={}): Promise<Download | FileChooser> {
    if (event === "download") {
      const info = await this.t.send<DownloadInfo>("playwright_wait_for_download", { context:this.ctx, tabId:this.tabId, options });
      return new Download(this.t, this.ctx, info);
    }
    const info = await this.t.send<FileChooserInfo>("playwright_wait_for_file_chooser", { context:this.ctx, tabId:this.tabId, options });
    return new FileChooser(this.t, this.ctx, this.tabId, info);
  }
  private make(step:LocatorStep): Locator {
    return new Locator(this.t, this.ctx, this.tabId, locatorAst(...this.frameSteps, step));
  }
}

export class Locator {
  constructor(private readonly t: BrowserTransport, private readonly ctx: BrowserContext, private readonly tabId: string, private readonly ast: LocatorAst) {}
  first(): Locator { return this.with({kind:"first"}); }
  last(): Locator { return this.with({kind:"last"}); }
  nth(index:number): Locator { return this.with({kind:"nth", index}); }
  filter(options:{hasText?:TextMatcher;hasNotText?:TextMatcher}): Locator { return this.with({kind:"filter", ...options}); }
  and(locator:Locator): Locator { return this.with({kind:"and", locator:locator.ast}); }
  or(locator:Locator): Locator { return this.with({kind:"or", locator:locator.ast}); }
  locator(selector:string): Locator { return this.with({kind:"locator", selector}); }
  getByRole(role:string, options:{name?:TextMatcher;exact?:boolean}={}): Locator { return this.with({kind:"role", role, ...options}); }
  getByText(text:TextMatcher, options:{exact?:boolean}={}): Locator { return this.with({kind:"text", text, ...options}); }
  getByLabel(text:TextMatcher, options:{exact?:boolean}={}): Locator { return this.with({kind:"label", text, ...options}); }
  getByPlaceholder(text:TextMatcher, options:{exact?:boolean}={}): Locator { return this.with({kind:"placeholder", text, ...options}); }
  getByTestId(testId:string): Locator { return this.with({kind:"testId", testId}); }
  click(options:{timeoutMs?:number;strict?:boolean}={}): Promise<void> { return this.send("playwright_locator_click", options); }
  dblclick(options:{timeoutMs?:number;strict?:boolean}={}): Promise<void> { return this.send("playwright_locator_dblclick", options); }
  fill(value:string, options:{timeoutMs?:number}={}): Promise<void> { return this.send("playwright_locator_fill", {...options, text:value}); }
  press(key:string, options:{timeoutMs?:number}={}): Promise<void> { return this.send("playwright_locator_press", {...options, key}); }
  selectOption(value:string|string[], options:{timeoutMs?:number}={}): Promise<void> { return this.send("playwright_locator_select_option", {...options, value}); }
  setChecked(checked:boolean, options:{timeoutMs?:number}={}): Promise<void> { return this.send("playwright_locator_set_checked", {...options, checked}); }
  check(options:{timeoutMs?:number}={}): Promise<void> { return this.send("playwright_locator_check", options); }
  uncheck(options:{timeoutMs?:number}={}): Promise<void> { return this.send("playwright_locator_uncheck", options); }
  getAttribute(name:string, options:{timeoutMs?:number}={}): Promise<string|null> { return this.send("playwright_locator_get_attribute", {...options, name}); }
  innerText(options:{timeoutMs?:number}={}): Promise<string> { return this.send("playwright_locator_inner_text", options); }
  textContent(options:{timeoutMs?:number}={}): Promise<string|null> { return this.send("playwright_locator_text_content", options); }
  inputValue(options:{timeoutMs?:number}={}): Promise<string> { return this.send("playwright_locator_input_value", options); }
  isVisible(): Promise<boolean> { return this.send("playwright_locator_is_visible", {}); }
  isEnabled(): Promise<boolean> { return this.send("playwright_locator_is_enabled", {}); }
  isChecked(): Promise<boolean> { return this.send("playwright_locator_is_checked", {}); }
  count(): Promise<number> { return this.send("playwright_locator_count", {}); }
  allTextContents(options:{timeoutMs?:number}={}): Promise<string[]> { return this.send("playwright_locator_all_text_contents", options); }
  readAll(options:{timeoutMs?:number}={}): Promise<Array<Record<string, unknown>>> { return this.send("playwright_locator_read_all", options); }
  async all(): Promise<Locator[]> { const count = await this.count(); return Array.from({length:count}, (_,index)=>this.nth(index)); }
  waitFor(options:{state?:"attached"|"detached"|"visible"|"hidden";timeoutMs?:number}={}): Promise<void> { return this.send("playwright_locator_wait_for", options); }
  downloadMedia(): Promise<{downloadId?:number}> { return this.send("playwright_locator_download_media", {}); }
  private with(step:LocatorStep): Locator { return new Locator(this.t, this.ctx, this.tabId, appendLocator(this.ast, step)); }
  private send<T=void>(method:BrowserCommandType, extra:Record<string,unknown>): Promise<T> {
    const payload:LocatorPayload & Record<string,unknown> = { locator:this.ast, ...extra };
    return this.t.send(method, { context:this.ctx, tabId:this.tabId, ...payload });
  }
}

export class FileChooser {
  constructor(private readonly t:BrowserTransport, private readonly ctx:BrowserContext, private readonly tabId:string, private readonly info:FileChooserInfo) {}
  isMultiple(): boolean { return this.info.multiple; }
  accept(): string | undefined { return this.info.accept; }
  setFiles(files:string[]): Promise<void> {
    return this.t.send("playwright_file_chooser_set_files", { context:this.ctx, tabId:this.tabId, chooserId:this.info.chooserId, files });
  }
}

export class Download {
  constructor(private readonly t:BrowserTransport, private readonly ctx:BrowserContext, private info:DownloadInfo) {}
  suggestedFilename(): string | undefined { return this.info.filename?.split(/[\\/]/).pop(); }
  path(): Promise<string | undefined> {
    return this.t.send<{path?:string}>("playwright_download_path", { context:this.ctx, downloadId:this.info.downloadId }).then(r=>r.path);
  }
}

class ClipboardAPI {
  constructor(private readonly t: BrowserTransport, private readonly ctx: BrowserContext, private readonly tabId: string) {}
  read(): Promise<unknown> { return this.t.send("tab_clipboard_read", { context:this.ctx, tabId:this.tabId }); }
  readText(): Promise<string> { return this.t.send("tab_clipboard_read_text", { context:this.ctx, tabId:this.tabId }); }
  write(data: unknown): Promise<void> { return this.t.send("tab_clipboard_write", { context:this.ctx, tabId:this.tabId, data }); }
  writeText(text: string): Promise<void> { return this.t.send("tab_clipboard_write_text", { context:this.ctx, tabId:this.tabId, text }); }
}
