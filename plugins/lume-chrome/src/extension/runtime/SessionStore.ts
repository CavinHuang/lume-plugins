import type { BrowserContext } from "../../shared/protocol";
import { PersistentState } from "./PersistentState";

export interface BrowserSessionRecord {
  sessionId: string;
  turnId?: string;
  name?: string;
  threadId?: string;
  tabGroupId?: number;
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
}
interface SessionState { records: Record<string, BrowserSessionRecord>; }

export class SessionStore {
  private state = new PersistentState<SessionState>("session", "LUME_BROWSER_SESSIONS_V4", { records: {} });
  private sessions = new Map<string, BrowserSessionRecord>();
  private initialized = false;
  async ready() {
    if (this.initialized) return;
    const stored = await this.state.load();
    this.sessions = new Map(Object.entries(stored.records));
    this.initialized = true;
  }
  private async persist() {
    await this.state.save({ records: Object.fromEntries(this.sessions) });
  }
  async getOrCreate(ctx: BrowserContext): Promise<BrowserSessionRecord> {
    await this.ready();
    const existing = this.sessions.get(ctx.browserSessionId);
    if (existing) {
      existing.turnId = ctx.browserTurnId;
      existing.threadId = ctx.threadId ?? existing.threadId;
      existing.updatedAt = Date.now();
      existing.endedAt = undefined;
      await this.persist();
      return existing;
    }
    const record: BrowserSessionRecord = {
      sessionId: ctx.browserSessionId,
      turnId: ctx.browserTurnId,
      threadId: ctx.threadId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.sessions.set(ctx.browserSessionId, record);
    await this.persist();
    return record;
  }
  async name(ctx: BrowserContext, name: string) { const s = await this.getOrCreate(ctx); s.name = name; s.updatedAt = Date.now(); await this.persist(); }
  async setTabGroup(ctx: BrowserContext, groupId: number) { const s = await this.getOrCreate(ctx); s.tabGroupId = groupId; await this.persist(); }
  async getTabGroup(ctx: BrowserContext) { return (await this.getOrCreate(ctx)).tabGroupId; }
  async endTurn(ctx: BrowserContext) { const s = await this.getOrCreate(ctx); s.endedAt = Date.now(); s.updatedAt = Date.now(); await this.persist(); }
  async remove(sessionId: string) { await this.ready(); this.sessions.delete(sessionId); await this.persist(); }
  async snapshot() { await this.ready(); return Array.from(this.sessions.values()); }
}
