import { PersistentState } from "./PersistentState.js";
export class SessionStore {
    state = new PersistentState("session", "LUME_BROWSER_SESSIONS_V4", { records: {} });
    sessions = new Map();
    initialized = false;
    async ready() {
        if (this.initialized)
            return;
        const stored = await this.state.load();
        this.sessions = new Map(Object.entries(stored.records));
        this.initialized = true;
    }
    async persist() {
        await this.state.save({ records: Object.fromEntries(this.sessions) });
    }
    async getOrCreate(ctx) {
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
        const record = {
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
    async name(ctx, name) { const s = await this.getOrCreate(ctx); s.name = name; s.updatedAt = Date.now(); await this.persist(); }
    async setTabGroup(ctx, groupId) { const s = await this.getOrCreate(ctx); s.tabGroupId = groupId; await this.persist(); }
    async getTabGroup(ctx) { return (await this.getOrCreate(ctx)).tabGroupId; }
    async endTurn(ctx) { const s = await this.getOrCreate(ctx); s.endedAt = Date.now(); s.updatedAt = Date.now(); await this.persist(); }
    async remove(sessionId) { await this.ready(); this.sessions.delete(sessionId); await this.persist(); }
    async snapshot() { await this.ready(); return Array.from(this.sessions.values()); }
}
