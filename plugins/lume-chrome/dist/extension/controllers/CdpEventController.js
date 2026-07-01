export class CdpEventController {
    native;
    cdp;
    subscriptions = new Map();
    constructor(native, cdp) {
        this.native = native;
        this.cdp = cdp;
        chrome.debugger.onEvent.addListener((source, method, params) => {
            if (typeof source.tabId !== "number")
                return;
            const set = this.subscriptions.get(source.tabId);
            if (!set?.has(method))
                return;
            this.native.notifyHost("browser.cdp.event", { chromeTabId: source.tabId, method, params, at: Date.now() });
        });
    }
    async subscribe(tabId, events) { await this.cdp.ensureAttached(tabId); this.subscriptions.set(tabId, new Set(events)); for (const domain of new Set(events.map(e => e.split(".")[0]))) {
        await this.cdp.send(tabId, `${domain}.enable`, {}, { allowMutating: true }).catch(() => undefined);
    } }
    cleanup(tabId) { this.subscriptions.delete(tabId); }
}
