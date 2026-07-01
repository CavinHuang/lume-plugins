import type { BrowserContext, FinalizeTabKeep, SessionTabInfo, UserTabInfo } from "../../shared/protocol";
import { BrowserRuntimeException, BrowserErrorCodes } from "../../shared/errors";
import { PersistentState } from "./PersistentState";

export interface TabLease {
  tabId: string;
  chromeTabId: number;
  browserSessionId: string;
  browserTurnId: string;
  createdByAgent: boolean;
  status: "active" | "handoff" | "deliverable";
  createdAt: number;
  updatedAt: number;
}
interface LeaseState { leases: Record<string, TabLease>; nextId: number; }

export class TabLeaseManager {
  private state = new PersistentState<LeaseState>("session", "LUME_BROWSER_TAB_LEASES_V4", { leases: {}, nextId: 1 });
  private leases = new Map<string, TabLease>();
  private byChromeTabId = new Map<number, string>();
  private nextId = 1;
  private initialized = false;

  async ready() {
    if (this.initialized) return;
    const stored = await this.state.load();
    this.leases = new Map(Object.entries(stored.leases));
    this.byChromeTabId = new Map(Array.from(this.leases.values()).map((l) => [l.chromeTabId, l.tabId]));
    this.nextId = stored.nextId;
    await this.reconcile();
    this.initialized = true;
  }
  private async persist() { await this.state.save({ leases: Object.fromEntries(this.leases), nextId: this.nextId }); }
  private async reconcile() {
    const existingTabs = new Set((await chrome.tabs.query({})).flatMap((t:any) => typeof t.id === "number" ? [t.id] : []));
    for (const lease of Array.from(this.leases.values())) if (!existingTabs.has(lease.chromeTabId)) this.dropSync(lease);
    await this.persist();
  }
  async openUserTabs(): Promise<UserTabInfo[]> {
    await this.ready();
    const tabs = await chrome.tabs.query({});
    return tabs.filter((t:any) => t.id !== undefined).sort((a:any,b:any)=>(b.lastAccessed??0)-(a.lastAccessed??0)).map((t:any) => ({
      id: `chrome-tab:${t.id}`, chromeTabId: t.id!, title: t.title, url: t.url,
      active: t.active, windowId: t.windowId, lastOpened: t.lastAccessed ? new Date(t.lastAccessed).toISOString() : undefined,
      tabGroup: t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? String(t.groupId) : undefined,
      faviconUrl: t.favIconUrl
    }));
  }
  async claimExisting(chromeTabId: number, ctx: BrowserContext): Promise<TabLease> {
    await this.ready();
    const existingId = this.byChromeTabId.get(chromeTabId);
    if (existingId) {
      const lease = this.leases.get(existingId)!;
      if (lease.browserSessionId !== ctx.browserSessionId) throw new BrowserRuntimeException(BrowserErrorCodes.TAB_OWNED_BY_OTHER_SESSION, "Tab is already claimed by another browser session", { chromeTabId });
      lease.browserTurnId = ctx.browserTurnId; lease.status = "active"; lease.updatedAt = Date.now(); await this.persist(); return lease;
    }
    return this.createLease(chromeTabId, ctx, false);
  }
  async createLease(chromeTabId: number, ctx: BrowserContext, createdByAgent = true): Promise<TabLease> {
    await this.ready();
    const tabId = `lume-tab:${this.nextId++}`;
    const lease: TabLease = { tabId, chromeTabId, browserSessionId: ctx.browserSessionId, browserTurnId: ctx.browserTurnId, createdByAgent, status: "active", createdAt: Date.now(), updatedAt: Date.now() };
    this.leases.set(tabId, lease); this.byChromeTabId.set(chromeTabId, tabId); await this.persist(); return lease;
  }
  async get(tabId: string, ctx: BrowserContext): Promise<TabLease> {
    await this.ready();
    const lease = this.leases.get(tabId);
    if (!lease) throw new BrowserRuntimeException(BrowserErrorCodes.TAB_NOT_CLAIMED, "Tab is not claimed", { tabId });
    if (lease.browserSessionId !== ctx.browserSessionId) throw new BrowserRuntimeException(BrowserErrorCodes.TAB_OWNED_BY_OTHER_SESSION, "Tab is owned by another session", { tabId });
    const tab = await chrome.tabs.get(lease.chromeTabId).catch(() => null);
    if (!tab) { this.dropSync(lease); await this.persist(); throw new BrowserRuntimeException(BrowserErrorCodes.TAB_NOT_CLAIMED, "Claimed tab no longer exists", { tabId }); }
    return lease;
  }
  async getByChromeTabId(chromeTabId:number):Promise<TabLease|undefined>{ await this.ready(); const id=this.byChromeTabId.get(chromeTabId); return id?this.leases.get(id):undefined; }
  async listSessionTabs(ctx: BrowserContext): Promise<SessionTabInfo[]> {
    await this.ready();
    const out: SessionTabInfo[] = [];
    for (const lease of this.leases.values()) if (lease.browserSessionId === ctx.browserSessionId) {
      const tab = await chrome.tabs.get(lease.chromeTabId).catch(() => null);
      if (tab) out.push({ id: lease.tabId, chromeTabId: lease.chromeTabId, title: tab.title, url: tab.url, active: tab.active, windowId: tab.windowId, status: lease.status, createdByAgent: lease.createdByAgent, leaseOwnerSessionId: lease.browserSessionId });
    }
    return out;
  }
  async release(tabIds: string[], ctx: BrowserContext) { for (const tabId of tabIds) this.dropSync(await this.get(tabId, ctx)); await this.persist(); }
  async handoff(tabIds: string[], ctx: BrowserContext) { for (const tabId of tabIds) { const l = await this.get(tabId, ctx); l.status = "handoff"; l.updatedAt = Date.now(); } await this.persist(); }
  async resumeHandoff(ctx:BrowserContext){ await this.ready(); return Array.from(this.leases.values()).filter(l=>l.browserSessionId===ctx.browserSessionId&&l.status==="handoff"); }
  async close(tabId:string, ctx:BrowserContext){ const l=await this.get(tabId,ctx); await chrome.tabs.remove(l.chromeTabId).catch(()=>undefined); this.dropSync(l); await this.persist(); }
  async finalize(ctx: BrowserContext, keep: FinalizeTabKeep[]) {
    await this.ready();
    const keepMap = new Map(keep.map(k => [k.tabId, k]));
    for (const lease of Array.from(this.leases.values())) {
      if (lease.browserSessionId !== ctx.browserSessionId) continue;
      const kept = keepMap.get(lease.tabId);
      if (kept) { lease.status = kept.status; lease.updatedAt = Date.now(); continue; }
      if (lease.createdByAgent) await chrome.tabs.remove(lease.chromeTabId).catch(() => undefined);
      this.dropSync(lease);
    }
    await this.persist();
  }
  async onTabRemoved(chromeTabId:number){ await this.ready(); const id=this.byChromeTabId.get(chromeTabId); if(id){ const l=this.leases.get(id); if(l)this.dropSync(l); await this.persist(); } }
  async snapshot(){ await this.ready(); return Array.from(this.leases.values()); }
  private dropSync(lease: TabLease) { this.leases.delete(lease.tabId); this.byChromeTabId.delete(lease.chromeTabId); }
}
