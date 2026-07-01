import { PersistentState } from "./PersistentState.js";
export class SitePermissionStore {
    state = new PersistentState("local", "LUME_BROWSER_SITE_PERMISSIONS_V4", { records: {} });
    async list() { return Object.values((await this.state.load()).records); }
    async get(host, ctx) {
        const r = (await this.state.load()).records[host.toLowerCase()];
        if (r?.decision === "allow_session" && r.sessionId !== ctx?.browserSessionId)
            return undefined;
        return r;
    }
    async set(host, decision, ctx) {
        const current = await this.state.load();
        const key = host.toLowerCase();
        current.records[key] = { host: key, decision, sessionId: decision === "allow_session" ? ctx?.browserSessionId : undefined, updatedAt: Date.now() };
        await this.state.save(current);
    }
    async clear(host) { const current = await this.state.load(); delete current.records[host.toLowerCase()]; await this.state.save(current); }
}
