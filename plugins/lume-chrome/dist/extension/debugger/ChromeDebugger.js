import { BrowserRuntimeException, BrowserErrorCodes } from "../../shared/errors.js";
import { MUTATING_CDP_METHODS, READ_ONLY_CDP_METHODS } from "../../shared/commands.js";
export class ChromeDebugger {
    attached = new Set();
    devLogs = new Map();
    cdpEvents = new Map();
    cdpSequence = 0;
    inflight = new Map();
    activeDialogs = new Map();
    constructor() {
        chrome.debugger.onEvent.addListener((source, method, params) => {
            if (typeof source.tabId !== "number")
                return;
            const event = { method, params, sequence: ++this.cdpSequence, source: { ...(source.extensionId ? { extensionId: source.extensionId } : {}), ...(source.sessionId ? { sessionId: source.sessionId } : {}), tabId: source.tabId, ...(source.targetId ? { targetId: source.targetId } : {}) } };
            const events = this.cdpEvents.get(source.tabId) ?? [];
            events.push(event);
            if (events.length > 1000)
                events.shift();
            this.cdpEvents.set(source.tabId, events);
            const arr = this.devLogs.get(source.tabId) ?? [];
            arr.push({ method, params, ts: Date.now() });
            if (arr.length > 1000)
                arr.shift();
            this.devLogs.set(source.tabId, arr);
            if (method === "Page.javascriptDialogOpening")
                this.activeDialogs.set(source.tabId, { type: params?.type ?? "alert", message: params?.message, defaultValue: params?.defaultPrompt });
            if (method === "Page.javascriptDialogClosed")
                this.activeDialogs.delete(source.tabId);
            if (method === "Network.requestWillBeSent")
                this.inflight.set(source.tabId, (this.inflight.get(source.tabId) ?? 0) + 1);
            if (method === "Network.loadingFinished" || method === "Network.loadingFailed")
                this.inflight.set(source.tabId, Math.max(0, (this.inflight.get(source.tabId) ?? 1) - 1));
        });
        chrome.debugger.onDetach.addListener((source) => { if (typeof source.tabId === "number") {
            this.attached.delete(source.tabId);
            this.inflight.delete(source.tabId);
            this.activeDialogs.delete(source.tabId);
            this.cdpEvents.delete(source.tabId);
        } });
    }
    async ensureAttached(tabId) {
        if (this.attached.has(tabId))
            return;
        try {
            await chrome.debugger.attach({ tabId }, "1.3");
            this.attached.add(tabId);
            await chrome.debugger.sendCommand({ tabId }, "Page.enable").catch(() => undefined);
            await chrome.debugger.sendCommand({ tabId }, "DOM.enable").catch(() => undefined);
            await chrome.debugger.sendCommand({ tabId }, "Runtime.enable").catch(() => undefined);
            await chrome.debugger.sendCommand({ tabId }, "Network.enable").catch(() => undefined);
            await chrome.debugger.sendCommand({ tabId }, "Log.enable").catch(() => undefined);
        }
        catch (error) {
            throw new BrowserRuntimeException(BrowserErrorCodes.DEBUGGER_ATTACH_FAILED, `Failed to attach debugger: ${String(error)}`, { tabId });
        }
    }
    async detach(tabId) { if (this.attached.has(tabId))
        await chrome.debugger.detach({ tabId }).catch(() => undefined); this.attached.delete(tabId); this.inflight.delete(tabId); }
    async send(tabId, method, params = {}, options = {}) {
        if (!options.allowMutating && !READ_ONLY_CDP_METHODS.has(method) && MUTATING_CDP_METHODS.has(method))
            throw new BrowserRuntimeException(BrowserErrorCodes.CDP_COMMAND_DENIED, `CDP method requires mutating permission: ${method}`);
        await this.ensureAttached(tabId);
        return await chrome.debugger.sendCommand({ tabId }, method, params);
    }
    async sendRaw(tabId, method, params = {}, options = {}) { await this.ensureAttached(tabId); const target = options.target?.targetId ? { targetId: options.target.targetId } : options.target?.sessionId ? { tabId, sessionId: options.target.sessionId } : { tabId }; const command = chrome.debugger.sendCommand(target, method, params); if (!options.timeoutMs)
        return command; return await Promise.race([command, new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for CDP command: ${method}`)), options.timeoutMs))]); }
    async readEvents(tabId, options = {}) { const current = this.cdpEvents.get(tabId)?.at(-1)?.sequence ?? this.cdpSequence; if (options.afterSequence === undefined)
        return { cursor: current, events: [], hasMore: false, truncated: false }; if (options.methods && options.methods.length === 0)
        throw new Error("cdp.readEvents methods must not be empty"); const after = Number(options.afterSequence); const limit = Math.max(1, Math.min(Number(options.limit ?? 100), 1000)); const methods = options.methods ? new Set(options.methods) : undefined; const target = options.target; const matching = () => { const events = this.cdpEvents.get(tabId) ?? []; return events.filter(e => e.sequence > after && (!methods || methods.has(e.method)) && (!target || (target.sessionId ? e.source.sessionId === target.sessionId : e.source.targetId === target.targetId))); }; const start = Date.now(); let found = matching(); while (found.length === 0 && options.timeoutMs && Date.now() - start < options.timeoutMs) {
        await new Promise(r => setTimeout(r, 50));
        found = matching();
    } const page = found.slice(0, limit); const earliest = (this.cdpEvents.get(tabId) ?? [])[0]?.sequence; return { cursor: page.at(-1)?.sequence ?? after, events: page, hasMore: found.length > page.length, truncated: earliest !== undefined && after < earliest - 1 }; }
    getDialog(tabId) { return this.activeDialogs.get(tabId); }
    async handleDialog(tabId, options) { await this.ensureAttached(tabId); await chrome.debugger.sendCommand({ tabId }, "Page.handleJavaScriptDialog", { accept: options.accept, ...(options.promptText !== undefined ? { promptText: options.promptText } : {}) }); this.activeDialogs.delete(tabId); }
    async screenshot(tabId, options = {}) {
        let clip = options.clip;
        if (options.fullPage && !clip) {
            const metrics = await this.send(tabId, "Page.getLayoutMetrics");
            const s = metrics.cssContentSize ?? metrics.contentSize;
            clip = { x: 0, y: 0, width: s.width, height: s.height };
        }
        const params = { format: options.format ?? "png", captureBeyondViewport: Boolean(options.fullPage) };
        if (options.quality !== undefined && params.format === "jpeg")
            params.quality = options.quality;
        if (clip)
            params.clip = { ...clip, scale: 1 };
        const r = await this.send(tabId, "Page.captureScreenshot", params);
        return { dataBase64: r.data, mimeType: `image/${params.format}` };
    }
    async click(tabId, x, y, clickCount = 1) { await this.dispatchMouse(tabId, "mouseMoved", x, y); await this.dispatchMouse(tabId, "mousePressed", x, y, { button: "left", clickCount }); await this.dispatchMouse(tabId, "mouseReleased", x, y, { button: "left", clickCount }); }
    dispatchMouse(tabId, type, x, y, extra = {}) { return this.send(tabId, "Input.dispatchMouseEvent", { type, x, y, ...extra }, { allowMutating: true }); }
    async drag(tabId, path) { if (path.length < 2)
        throw new Error("Drag path requires at least two points"); const first = path[0]; await this.dispatchMouse(tabId, "mouseMoved", first.x, first.y); await this.dispatchMouse(tabId, "mousePressed", first.x, first.y, { button: "left", buttons: 1 }); for (const point of path.slice(1)) {
        await this.dispatchMouse(tabId, "mouseMoved", point.x, point.y, { button: "left", buttons: 1 });
        await new Promise(r => setTimeout(r, 16));
    } const last = path[path.length - 1]; await this.dispatchMouse(tabId, "mouseReleased", last.x, last.y, { button: "left", buttons: 0 }); }
    async keypress(tabId, key) { await this.send(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key }, { allowMutating: true }); await this.send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key }, { allowMutating: true }); }
    typeText(tabId, text) { return this.send(tabId, "Input.insertText", { text }, { allowMutating: true }); }
    setViewport(tabId, options) { return this.send(tabId, "Emulation.setDeviceMetricsOverride", { width: options.width, height: options.height, deviceScaleFactor: options.deviceScaleFactor ?? 1, mobile: options.mobile ?? false }, { allowMutating: true }); }
    resetViewport(tabId) { return this.send(tabId, "Emulation.clearDeviceMetricsOverride", {}, { allowMutating: true }); }
    async navigateHistory(tabId, direction) { const history = await this.send(tabId, "Page.getNavigationHistory"); const index = history.currentIndex + direction; const entry = history.entries[index]; if (!entry)
        return; await this.send(tabId, "Page.navigateToHistoryEntry", { entryId: entry.id }, { allowMutating: true }); }
    async waitForNetworkIdle(tabId, timeoutMs = 10_000, idleMs = 500) { await this.ensureAttached(tabId); const start = Date.now(); let idleStart = 0; while (Date.now() - start < timeoutMs) {
        if ((this.inflight.get(tabId) ?? 0) === 0) {
            if (!idleStart)
                idleStart = Date.now();
            if (Date.now() - idleStart >= idleMs)
                return;
        }
        else
            idleStart = 0;
        await new Promise(r => setTimeout(r, 100));
    } throw new Error("Timed out waiting for network idle"); }
    logs(tabId) { return this.devLogs.get(tabId) ?? []; }
    cleanup(tabId) { this.devLogs.delete(tabId); this.cdpEvents.delete(tabId); this.inflight.delete(tabId); this.activeDialogs.delete(tabId); return this.detach(tabId); }
}
