import { NATIVE_HOST_NAME } from "../../shared/protocol.js";
export class NativeTransport {
    onMessage;
    port = null;
    status = "disconnected";
    reconnectAlarm = "lume-native-transport-reconnect";
    pending = new Map();
    seq = 1;
    constructor(onMessage) {
        this.onMessage = onMessage;
    }
    getStatus() { return { status: this.status, host: NATIVE_HOST_NAME, connected: this.port !== null, updatedAt: Date.now() }; }
    start() {
        chrome.alarms.onAlarm.addListener((a) => { if (a.name === this.reconnectAlarm && !this.port)
            this.connect(); });
        this.connect();
    }
    connect() {
        if (this.port)
            return;
        try {
            this.port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
            this.status = "connected";
            void chrome.storage.local.set({ NATIVE_HOST_STATUS: this.getStatus() });
            this.port.onMessage.addListener((message) => void this.handleIncoming(message));
            this.port.onDisconnect.addListener(() => this.handleDisconnect());
            void this.requestHost("host.hello", { extensionId: chrome.runtime.id, extensionVersion: chrome.runtime.getManifest().version }, 5_000).catch(() => undefined);
        }
        catch (error) {
            this.status = "disconnected";
            void chrome.storage.local.set({ NATIVE_HOST_STATUS: { ...this.getStatus(), lastError: String(error) } });
            chrome.alarms.create(this.reconnectAlarm, { delayInMinutes: 0.08 });
        }
    }
    async requestHost(method, params, timeoutMs = 30_000) {
        if (!this.port)
            this.connect();
        if (!this.port)
            throw new Error("Native host is not connected");
        const id = `ext-${Date.now()}-${this.seq++}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Native host request timed out: ${method}`)); }, timeoutMs);
            this.pending.set(id, { resolve: resolve, reject, timer });
            this.port.postMessage({ jsonrpc: "2.0", id, method, params });
        });
    }
    notifyHost(method, params) { this.port?.postMessage({ jsonrpc: "2.0", method, params }); }
    async handleIncoming(message) {
        if (message?.id && ("result" in message || "error" in message)) {
            const pending = this.pending.get(String(message.id));
            if (!pending)
                return;
            clearTimeout(pending.timer);
            this.pending.delete(String(message.id));
            if (message.error)
                pending.reject(Object.assign(new Error(message.error.message ?? "Native host error"), { code: message.error.code, details: message.error.details }));
            else
                pending.resolve(message.result);
            return;
        }
        if (message?.id && message?.method) {
            const response = await this.onMessage(message);
            this.port?.postMessage(response);
        }
    }
    handleDisconnect() {
        const lastError = chrome.runtime.lastError?.message;
        this.port = null;
        this.status = "reconnecting";
        for (const [id, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(new Error(`Native host disconnected during request ${id}`));
        }
        this.pending.clear();
        void chrome.storage.local.set({ NATIVE_HOST_STATUS: { ...this.getStatus(), lastError } });
        chrome.alarms.create(this.reconnectAlarm, { delayInMinutes: 0.08 });
    }
}
