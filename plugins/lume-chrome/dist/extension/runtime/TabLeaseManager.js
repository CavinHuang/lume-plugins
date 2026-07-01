import { BrowserRuntimeException, BrowserErrorCodes } from "../../shared/errors.js";
import { PersistentState } from "./PersistentState.js";
export class TabLeaseManager {
    state = new PersistentState("session", "LUME_BROWSER_TAB_LEASES_V4", { leases: {}, nextId: 1 });
    leases = new Map();
    byChromeTabId = new Map();
    nextId = 1;
    initialized = false;
    async ready() {
        if (this.initialized)
            return;
        const stored = await this.state.load();
        this.leases = new Map(Object.entries(stored.leases));
        this.byChromeTabId = new Map(Array.from(this.leases.values()).map((l) => [l.chromeTabId, l.tabId]));
        this.nextId = stored.nextId;
        await this.reconcile();
        this.initialized = true;
    }
    async persist() { await this.state.save({ leases: Object.fromEntries(this.leases), nextId: this.nextId }); }
    async reconcile() {
        const existingTabs = new Set((await chrome.tabs.query({})).flatMap((t) => typeof t.id === "number" ? [t.id] : []));
        for (const lease of Array.from(this.leases.values()))
            if (!existingTabs.has(lease.chromeTabId))
                this.dropSync(lease);
        await this.persist();
    }
    async openUserTabs() {
        await this.ready();
        const tabs = await chrome.tabs.query({});
        return tabs.filter((t) => t.id !== undefined).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)).map((t) => ({
            id: `chrome-tab:${t.id}`, chromeTabId: t.id, title: t.title, url: t.url,
            active: t.active, windowId: t.windowId, lastOpened: t.lastAccessed ? new Date(t.lastAccessed).toISOString() : undefined,
            tabGroup: t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? String(t.groupId) : undefined,
            faviconUrl: t.favIconUrl
        }));
    }
    async claimExisting(chromeTabId, ctx) {
        await this.ready();
        const existingId = this.byChromeTabId.get(chromeTabId);
        if (existingId) {
            const lease = this.leases.get(existingId);
            if (lease.browserSessionId !== ctx.browserSessionId)
                throw new BrowserRuntimeException(BrowserErrorCodes.TAB_OWNED_BY_OTHER_SESSION, "Tab is already claimed by another browser session", { chromeTabId });
            lease.browserTurnId = ctx.browserTurnId;
            lease.status = "active";
            lease.updatedAt = Date.now();
            await this.persist();
            return lease;
        }
        return this.createLease(chromeTabId, ctx, false);
    }
    async createLease(chromeTabId, ctx, createdByAgent = true) {
        await this.ready();
        const tabId = `lume-tab:${this.nextId++}`;
        const lease = { tabId, chromeTabId, browserSessionId: ctx.browserSessionId, browserTurnId: ctx.browserTurnId, createdByAgent, status: "active", createdAt: Date.now(), updatedAt: Date.now() };
        this.leases.set(tabId, lease);
        this.byChromeTabId.set(chromeTabId, tabId);
        await this.persist();
        return lease;
    }
    async get(tabId, ctx) {
        await this.ready();
        const lease = this.leases.get(tabId);
        if (!lease)
            throw new BrowserRuntimeException(BrowserErrorCodes.TAB_NOT_CLAIMED, "Tab is not claimed", { tabId });
        if (lease.browserSessionId !== ctx.browserSessionId)
            throw new BrowserRuntimeException(BrowserErrorCodes.TAB_OWNED_BY_OTHER_SESSION, "Tab is owned by another session", { tabId });
        const tab = await chrome.tabs.get(lease.chromeTabId).catch(() => null);
        if (!tab) {
            this.dropSync(lease);
            await this.persist();
            throw new BrowserRuntimeException(BrowserErrorCodes.TAB_NOT_CLAIMED, "Claimed tab no longer exists", { tabId });
        }
        return lease;
    }
    async getByChromeTabId(chromeTabId) { await this.ready(); const id = this.byChromeTabId.get(chromeTabId); return id ? this.leases.get(id) : undefined; }
    async listSessionTabs(ctx) {
        await this.ready();
        const out = [];
        for (const lease of this.leases.values())
            if (lease.browserSessionId === ctx.browserSessionId) {
                const tab = await chrome.tabs.get(lease.chromeTabId).catch(() => null);
                if (tab)
                    out.push({ id: lease.tabId, chromeTabId: lease.chromeTabId, title: tab.title, url: tab.url, active: tab.active, windowId: tab.windowId, status: lease.status, createdByAgent: lease.createdByAgent, leaseOwnerSessionId: lease.browserSessionId });
            }
        return out;
    }
    async release(tabIds, ctx) { for (const tabId of tabIds)
        this.dropSync(await this.get(tabId, ctx)); await this.persist(); }
    async handoff(tabIds, ctx) { for (const tabId of tabIds) {
        const l = await this.get(tabId, ctx);
        l.status = "handoff";
        l.updatedAt = Date.now();
    } await this.persist(); }
    async resumeHandoff(ctx) { await this.ready(); return Array.from(this.leases.values()).filter(l => l.browserSessionId === ctx.browserSessionId && l.status === "handoff"); }
    async close(tabId, ctx) { const l = await this.get(tabId, ctx); await chrome.tabs.remove(l.chromeTabId).catch(() => undefined); this.dropSync(l); await this.persist(); }
    async finalize(ctx, keep) {
        await this.ready();
        const keepMap = new Map(keep.map(k => [k.tabId, k]));
        for (const lease of Array.from(this.leases.values())) {
            if (lease.browserSessionId !== ctx.browserSessionId)
                continue;
            const kept = keepMap.get(lease.tabId);
            if (kept) {
                lease.status = kept.status;
                lease.updatedAt = Date.now();
                continue;
            }
            if (lease.createdByAgent)
                await chrome.tabs.remove(lease.chromeTabId).catch(() => undefined);
            this.dropSync(lease);
        }
        await this.persist();
    }
    async onTabRemoved(chromeTabId) { await this.ready(); const id = this.byChromeTabId.get(chromeTabId); if (id) {
        const l = this.leases.get(id);
        if (l)
            this.dropSync(l);
        await this.persist();
    } }
    async snapshot() { await this.ready(); return Array.from(this.leases.values()); }
    dropSync(lease) { this.leases.delete(lease.tabId); this.byChromeTabId.delete(lease.chromeTabId); }
}
