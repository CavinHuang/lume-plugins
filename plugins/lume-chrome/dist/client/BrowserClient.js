import { appendLocator, locatorAst } from "../shared/locator.js";
export class JsonRpcTransport {
    post;
    seq = 1;
    constructor(post) {
        this.post = post;
    }
    async send(method, params) {
        const id = String(this.seq++);
        const response = await this.post({ jsonrpc: "2.0", id, method, params });
        if ("error" in response) {
            const err = new Error(response.error.message);
            err.code = response.error.code;
            err.details = response.error.details;
            err.recoverable = response.error.recoverable;
            throw err;
        }
        return response.result;
    }
}
export class BrowserRegistry {
    transport;
    context;
    constructor(transport, context) {
        this.transport = transport;
        this.context = context;
    }
    async get(id = "extension") {
        const caps = await this.transport.send("runtime_ping", { clientType: id, context: this.context });
        return new Browser(this.transport, this.context, caps);
    }
    list() {
        return this.transport.send("runtime_list_browsers", { context: this.context });
    }
    diagnostics() {
        return this.transport.send("runtime_diagnostics", { context: this.context });
    }
}
class CapabilityCollection {
    t;
    ctx;
    scope;
    tabId;
    constructor(t, ctx, scope, tabId) {
        this.t = t;
        this.ctx = ctx;
        this.scope = scope;
        this.tabId = tabId;
    }
    list() {
        return this.t.send(this.scope === "browser" ? "browser_capabilities_list" : "tab_capabilities_list", {
            context: this.ctx,
            tabId: this.tabId
        });
    }
    async get(id) {
        const info = (await this.list()).find((item) => item.id === id);
        if (!info)
            throw new Error(`Capability not available: ${id}`);
        return new Capability(this.t, this.ctx, this.scope, info, this.tabId);
    }
}
class Capability {
    t;
    ctx;
    scope;
    info;
    tabId;
    constructor(t, ctx, scope, info, tabId) {
        this.t = t;
        this.ctx = ctx;
        this.scope = scope;
        this.info = info;
        this.tabId = tabId;
    }
    documentation() {
        return this.t.send(this.scope === "browser" ? "browser_capability_documentation" : "tab_capability_documentation", {
            context: this.ctx,
            tabId: this.tabId,
            capabilityId: this.info.id
        });
    }
}
export class Browser {
    t;
    ctx;
    info;
    browserId;
    user;
    tabs;
    capabilities;
    constructor(t, ctx, info) {
        this.t = t;
        this.ctx = ctx;
        this.info = info;
        this.browserId = info.browserId;
        this.user = new BrowserUser(t, ctx);
        this.tabs = new Tabs(t, ctx);
        this.capabilities = new CapabilityCollection(t, ctx, "browser");
    }
    documentation() { return this.t.send("browser_documentation", { context: this.ctx }); }
    nameSession(name) { return this.t.send("browser_name_session", { context: this.ctx, name }); }
    visibility = {
        get: () => this.t.send("browser_visibility_get", { context: this.ctx }),
        set: (visibility) => this.t.send("browser_visibility_set", { context: this.ctx, visibility })
    };
    viewport = {
        set: (options) => this.t.send("browser_viewport_set", { context: this.ctx, options }),
        reset: () => this.t.send("browser_viewport_reset", { context: this.ctx })
    };
    sitePermissions = {
        list: () => this.t.send("browser_site_permissions_list", { context: this.ctx }),
        allowForSession: (host) => this.t.send("browser_site_permission_set", { context: this.ctx, host, decision: "allow_session" }),
        alwaysAllow: (host) => this.t.send("browser_site_permission_set", { context: this.ctx, host, decision: "allow_always" }),
        block: (host) => this.t.send("browser_site_permission_set", { context: this.ctx, host, decision: "block" }),
        clear: (host) => this.t.send("browser_site_permission_clear", { context: this.ctx, host })
    };
}
export class BrowserUser {
    t;
    ctx;
    constructor(t, ctx) {
        this.t = t;
        this.ctx = ctx;
    }
    openTabs() { return this.t.send("browser_user_open_tabs", { context: this.ctx }); }
    async claimTab(tab) {
        const tabId = typeof tab === "string" ? tab : tab.id;
        const result = await this.t.send("browser_user_claim_tab", { context: this.ctx, tabId });
        return new Tab(this.t, this.ctx, result.tabId);
    }
    history(options = {}) {
        return this.t.send("browser_user_history", { context: this.ctx, options });
    }
    topSites() { return this.t.send("top_sites_get", { context: this.ctx }); }
    recentSessions() { return this.t.send("sessions_get_recently_closed", { context: this.ctx }); }
}
export class Tabs {
    t;
    ctx;
    constructor(t, ctx) {
        this.t = t;
        this.ctx = ctx;
    }
    async new(options = {}) {
        const r = await this.t.send("create_tab", { context: this.ctx, options });
        return new Tab(this.t, this.ctx, r.tabId);
    }
    async get(id) {
        const r = await this.t.send("get_tab", { context: this.ctx, tabId: id });
        return new Tab(this.t, this.ctx, r.tabId);
    }
    async selected() {
        const r = await this.t.send("selected_tab", { context: this.ctx });
        return r.tabId ? new Tab(this.t, this.ctx, r.tabId) : undefined;
    }
    list() { return this.t.send("list_tabs", { context: this.ctx }); }
    sessionTabs() { return this.t.send("get_session_tabs", { context: this.ctx }); }
    finalize(options = {}) { return this.t.send("finalize_tabs", { context: this.ctx, keep: options.keep ?? [] }); }
    release(tabIds) { return this.t.send("release_tabs", { context: this.ctx, tabIds }); }
    handoff(tabIds) { return this.t.send("handoff_tabs", { context: this.ctx, tabIds }); }
    resumeHandoff() {
        return this.t.send("resume_handoff_tabs", { context: this.ctx }).then(xs => xs.map(x => new Tab(this.t, this.ctx, x.tabId)));
    }
}
export class Tab {
    t;
    ctx;
    id;
    cua;
    dom_cua;
    playwright;
    capabilities;
    clipboard;
    dev;
    constructor(t, ctx, id) {
        this.t = t;
        this.ctx = ctx;
        this.id = id;
        this.cua = new CUAAPI(t, ctx, id);
        this.dom_cua = new DomCUAAPI(t, ctx, id);
        this.playwright = new PlaywrightAPI(t, ctx, id);
        this.capabilities = Object.assign(new CapabilityCollection(t, ctx, "tab", id), { pageAssets: new PageAssetsCapability(t, ctx, id) });
        this.clipboard = new ClipboardAPI(t, ctx, id);
        this.dev = new TabDevAPI(t, ctx, id);
    }
    close() { return this.t.send("close_tab", { context: this.ctx, tabId: this.id }); }
    title() { return this.t.send("tab_title", { context: this.ctx, tabId: this.id }); }
    url() { return this.t.send("tab_url", { context: this.ctx, tabId: this.id }); }
    goto(url, options = {}) {
        return this.t.send("navigate_tab_url", { context: this.ctx, tabId: this.id, url, options });
    }
    back() { return this.t.send("navigate_tab_back", { context: this.ctx, tabId: this.id }); }
    forward() { return this.t.send("navigate_tab_forward", { context: this.ctx, tabId: this.id }); }
    reload() { return this.t.send("navigate_tab_reload", { context: this.ctx, tabId: this.id }); }
    screenshot(options = {}) {
        return this.t.send("tab_screenshot", { context: this.ctx, tabId: this.id, options })
            .then((result) => Uint8Array.from(atob(result.dataBase64), c => c.charCodeAt(0)));
    }
    exportContent(options) {
        return this.t.send(options.format === "gsuite" ? "tab_content_export_gsuite" : "tab_content_export", { context: this.ctx, tabId: this.id, options });
    }
}
class TabDevAPI {
    t;
    ctx;
    tabId;
    constructor(t, ctx, tabId) {
        this.t = t;
        this.ctx = ctx;
        this.tabId = tabId;
    }
    cdpCall(method, params, allowMutating = false) {
        return this.t.send("tab_cdp_call", { context: this.ctx, tabId: this.tabId, method, params, allowMutating });
    }
    subscribe(events) { return this.t.send("tab_cdp_events", { context: this.ctx, tabId: this.tabId, events }); }
    logs() { return this.t.send("tab_dev_logs", { context: this.ctx, tabId: this.tabId }); }
}
class CUAAPI {
    t;
    ctx;
    tabId;
    constructor(t, ctx, tabId) {
        this.t = t;
        this.ctx = ctx;
        this.tabId = tabId;
    }
    click(options) { return this.t.send("cua_click", { context: this.ctx, tabId: this.tabId, ...options }); }
    double_click(options) { return this.t.send("cua_double_click", { context: this.ctx, tabId: this.tabId, ...options }); }
    move(options) { return this.t.send("cua_move", { context: this.ctx, tabId: this.tabId, ...options }); }
    drag(options) { return this.t.send("cua_drag", { context: this.ctx, tabId: this.tabId, ...options }); }
    scroll(options) { return this.t.send("cua_scroll", { context: this.ctx, tabId: this.tabId, ...options }); }
    type(options) { return this.t.send("cua_type", { context: this.ctx, tabId: this.tabId, ...options }); }
    keypress(options) { return this.t.send("cua_keypress", { context: this.ctx, tabId: this.tabId, ...options }); }
    downloadMedia(options) { return this.t.send("cua_download_media", { context: this.ctx, tabId: this.tabId, ...options }); }
}
class DomCUAAPI {
    t;
    ctx;
    tabId;
    constructor(t, ctx, tabId) {
        this.t = t;
        this.ctx = ctx;
        this.tabId = tabId;
    }
    get_visible_dom() { return this.t.send("dom_cua_get_visible_dom", { context: this.ctx, tabId: this.tabId }); }
    click(options) { return this.t.send("dom_cua_click", { context: this.ctx, tabId: this.tabId, ...options }); }
    double_click(options) { return this.t.send("dom_cua_double_click", { context: this.ctx, tabId: this.tabId, ...options }); }
    type(options) { return this.t.send("dom_cua_type", { context: this.ctx, tabId: this.tabId, ...options }); }
    keypress(options) { return this.t.send("dom_cua_keypress", { context: this.ctx, tabId: this.tabId, ...options }); }
    scroll(options) { return this.t.send("dom_cua_scroll", { context: this.ctx, tabId: this.tabId, ...options }); }
    downloadMedia(options) { return this.t.send("dom_cua_download_media", { context: this.ctx, tabId: this.tabId, ...options }); }
}
export class PlaywrightAPI {
    t;
    ctx;
    tabId;
    frameSteps;
    constructor(t, ctx, tabId, frameSteps = []) {
        this.t = t;
        this.ctx = ctx;
        this.tabId = tabId;
        this.frameSteps = frameSteps;
    }
    domSnapshot() { return this.t.send("playwright_dom_snapshot", { context: this.ctx, tabId: this.tabId }); }
    evaluate(expression, arg) {
        return this.t.send("playwright_evaluate", { context: this.ctx, tabId: this.tabId, expression, arg });
    }
    async expectNavigation(action, options = {}) {
        const result = await action();
        if (options.url)
            await this.waitForURL(options.url, { timeoutMs: options.timeoutMs });
        else
            await this.waitForLoadState({ state: options.waitUntil === "commit" ? "domcontentloaded" : options.waitUntil ?? "load", timeoutMs: options.timeoutMs });
        return result;
    }
    frameLocator(frameSelector) { return new PlaywrightAPI(this.t, this.ctx, this.tabId, [...this.frameSteps, { kind: "frame", selector: frameSelector }]); }
    locator(selector) { return this.make({ kind: "locator", selector }); }
    getByRole(role, options = {}) { return this.make({ kind: "role", role, ...options }); }
    getByText(text, options = {}) { return this.make({ kind: "text", text, ...options }); }
    getByLabel(text, options = {}) { return this.make({ kind: "label", text, ...options }); }
    getByPlaceholder(text, options = {}) { return this.make({ kind: "placeholder", text, ...options }); }
    getByTestId(testId) { return this.make({ kind: "testId", testId }); }
    waitForURL(url, options = {}) { return this.t.send("playwright_wait_for_url", { context: this.ctx, tabId: this.tabId, url, options }); }
    waitForLoadState(options = {}) { return this.t.send("playwright_wait_for_load_state", { context: this.ctx, tabId: this.tabId, ...options }); }
    waitForTimeout(timeoutMs) { return this.t.send("playwright_wait_for_timeout", { context: this.ctx, tabId: this.tabId, timeoutMs }); }
    async waitForEvent(event, options = {}) {
        if (event === "download") {
            const info = await this.t.send("playwright_wait_for_download", { context: this.ctx, tabId: this.tabId, options });
            return new Download(this.t, this.ctx, info);
        }
        const info = await this.t.send("playwright_wait_for_file_chooser", { context: this.ctx, tabId: this.tabId, options });
        return new FileChooser(this.t, this.ctx, this.tabId, info);
    }
    make(step) {
        return new Locator(this.t, this.ctx, this.tabId, locatorAst(...this.frameSteps, step));
    }
}
export class Locator {
    t;
    ctx;
    tabId;
    ast;
    constructor(t, ctx, tabId, ast) {
        this.t = t;
        this.ctx = ctx;
        this.tabId = tabId;
        this.ast = ast;
    }
    first() { return this.with({ kind: "first" }); }
    last() { return this.with({ kind: "last" }); }
    nth(index) { return this.with({ kind: "nth", index }); }
    filter(options) { return this.with({ kind: "filter", ...options }); }
    and(locator) { return this.with({ kind: "and", locator: locator.ast }); }
    or(locator) { return this.with({ kind: "or", locator: locator.ast }); }
    locator(selector) { return this.with({ kind: "locator", selector }); }
    getByRole(role, options = {}) { return this.with({ kind: "role", role, ...options }); }
    getByText(text, options = {}) { return this.with({ kind: "text", text, ...options }); }
    getByLabel(text, options = {}) { return this.with({ kind: "label", text, ...options }); }
    getByPlaceholder(text, options = {}) { return this.with({ kind: "placeholder", text, ...options }); }
    getByTestId(testId) { return this.with({ kind: "testId", testId }); }
    click(options = {}) { return this.send("playwright_locator_click", options); }
    dblclick(options = {}) { return this.send("playwright_locator_dblclick", options); }
    fill(value, options = {}) { return this.send("playwright_locator_fill", { ...options, text: value }); }
    press(key, options = {}) { return this.send("playwright_locator_press", { ...options, key }); }
    selectOption(value, options = {}) { return this.send("playwright_locator_select_option", { ...options, value }); }
    setChecked(checked, options = {}) { return this.send("playwright_locator_set_checked", { ...options, checked }); }
    check(options = {}) { return this.send("playwright_locator_check", options); }
    uncheck(options = {}) { return this.send("playwright_locator_uncheck", options); }
    getAttribute(name, options = {}) { return this.send("playwright_locator_get_attribute", { ...options, name }); }
    innerText(options = {}) { return this.send("playwright_locator_inner_text", options); }
    textContent(options = {}) { return this.send("playwright_locator_text_content", options); }
    inputValue(options = {}) { return this.send("playwright_locator_input_value", options); }
    isVisible() { return this.send("playwright_locator_is_visible", {}); }
    isEnabled() { return this.send("playwright_locator_is_enabled", {}); }
    isChecked() { return this.send("playwright_locator_is_checked", {}); }
    count() { return this.send("playwright_locator_count", {}); }
    allTextContents(options = {}) { return this.send("playwright_locator_all_text_contents", options); }
    readAll(options = {}) { return this.send("playwright_locator_read_all", options); }
    async all() { const count = await this.count(); return Array.from({ length: count }, (_, index) => this.nth(index)); }
    waitFor(options = {}) { return this.send("playwright_locator_wait_for", options); }
    downloadMedia() { return this.send("playwright_locator_download_media", {}); }
    with(step) { return new Locator(this.t, this.ctx, this.tabId, appendLocator(this.ast, step)); }
    send(method, extra) {
        const payload = { locator: this.ast, ...extra };
        return this.t.send(method, { context: this.ctx, tabId: this.tabId, ...payload });
    }
}
export class FileChooser {
    t;
    ctx;
    tabId;
    info;
    constructor(t, ctx, tabId, info) {
        this.t = t;
        this.ctx = ctx;
        this.tabId = tabId;
        this.info = info;
    }
    isMultiple() { return this.info.multiple; }
    accept() { return this.info.accept; }
    setFiles(files) {
        return this.t.send("playwright_file_chooser_set_files", { context: this.ctx, tabId: this.tabId, chooserId: this.info.chooserId, files });
    }
}
export class Download {
    t;
    ctx;
    info;
    constructor(t, ctx, info) {
        this.t = t;
        this.ctx = ctx;
        this.info = info;
    }
    suggestedFilename() { return this.info.filename?.split(/[\\/]/).pop(); }
    path() {
        return this.t.send("playwright_download_path", { context: this.ctx, downloadId: this.info.downloadId }).then(r => r.path);
    }
}
class PageAssetsCapability {
    t;
    ctx;
    tabId;
    constructor(t, ctx, tabId) {
        this.t = t;
        this.ctx = ctx;
        this.tabId = tabId;
    }
    list() { return this.t.send("tab_page_assets_list", { context: this.ctx, tabId: this.tabId }); }
    bundle(options = {}) {
        return this.t.send("tab_page_assets_bundle", { context: this.ctx, tabId: this.tabId, options });
    }
    documentation() {
        return this.t.send("tab_capability_documentation", { context: this.ctx, tabId: this.tabId, capabilityId: "pageAssets" });
    }
}
class ClipboardAPI {
    t;
    ctx;
    tabId;
    constructor(t, ctx, tabId) {
        this.t = t;
        this.ctx = ctx;
        this.tabId = tabId;
    }
    read() { return this.t.send("tab_clipboard_read", { context: this.ctx, tabId: this.tabId }); }
    readText() { return this.t.send("tab_clipboard_read_text", { context: this.ctx, tabId: this.tabId }); }
    write(data) { return this.t.send("tab_clipboard_write", { context: this.ctx, tabId: this.tabId, data }); }
    writeText(text) { return this.t.send("tab_clipboard_write_text", { context: this.ctx, tabId: this.tabId, text }); }
}
