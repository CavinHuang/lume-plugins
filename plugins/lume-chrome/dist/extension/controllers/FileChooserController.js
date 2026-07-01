export class FileChooserController {
    cdp;
    pending = new Map();
    choosers = new Map();
    constructor(cdp) {
        this.cdp = cdp;
        chrome.debugger.onEvent.addListener((source, method, params) => {
            if (method !== "Page.fileChooserOpened" || typeof source.tabId !== "number")
                return;
            const p = this.pending.get(source.tabId);
            if (!p)
                return;
            clearTimeout(p.timer);
            this.pending.delete(source.tabId);
            const chooserId = `chooser:${source.tabId}:${Date.now()}`;
            const record = { chooserId, tabId: source.tabId, backendNodeId: params.backendNodeId, multiple: params.mode === "selectMultiple", createdAt: Date.now() };
            this.choosers.set(chooserId, record);
            p.resolve(record);
        });
    }
    async wait(tabId, timeoutMs = 10_000) {
        await this.cdp.ensureAttached(tabId);
        await this.cdp.send(tabId, "Page.setInterceptFileChooserDialog", { enabled: true }, { allowMutating: true });
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(tabId); reject(new Error("Timed out waiting for file chooser")); }, timeoutMs);
            this.pending.set(tabId, { resolve, reject, timer });
        });
    }
    async setFiles(tabId, chooserId, files) {
        const chooser = this.choosers.get(chooserId);
        if (!chooser || chooser.tabId !== tabId)
            throw new Error("File chooser is missing, expired, or belongs to another tab");
        if (!chooser.multiple && files.length > 1)
            throw new Error("This file input does not accept multiple files");
        if (files.some(f => !/^([A-Za-z]:[\\/]|\/)/.test(f)))
            throw new Error("File upload requires absolute paths");
        await this.cdp.send(tabId, "DOM.setFileInputFiles", { backendNodeId: chooser.backendNodeId, files }, { allowMutating: true });
        this.choosers.delete(chooserId);
        await this.cdp.send(tabId, "Page.setInterceptFileChooserDialog", { enabled: false }, { allowMutating: true }).catch(() => undefined);
    }
    cleanupTab(tabId) { for (const [id, c] of this.choosers)
        if (c.tabId === tabId)
            this.choosers.delete(id); const p = this.pending.get(tabId); if (p) {
        clearTimeout(p.timer);
        p.reject(new Error("Tab closed"));
        this.pending.delete(tabId);
    } }
}
