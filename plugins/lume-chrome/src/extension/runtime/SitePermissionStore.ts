import type { BrowserContext, SitePermissionRecord } from "../../shared/protocol";
import { PersistentState } from "./PersistentState";

interface PermissionState { records: Record<string, SitePermissionRecord>; }
export class SitePermissionStore {
  private state = new PersistentState<PermissionState>("local", "LUME_BROWSER_SITE_PERMISSIONS_V4", { records: {} });
  async list(): Promise<SitePermissionRecord[]> { return Object.values((await this.state.load()).records); }
  async get(host:string, ctx?:BrowserContext):Promise<SitePermissionRecord|undefined>{
    const r=(await this.state.load()).records[host.toLowerCase()];
    if(r?.decision==="allow_session" && r.sessionId!==ctx?.browserSessionId) return undefined;
    return r;
  }
  async set(host:string, decision:SitePermissionRecord["decision"], ctx?:BrowserContext){
    const current=await this.state.load(); const key=host.toLowerCase();
    current.records[key]={host:key, decision, sessionId:decision==="allow_session"?ctx?.browserSessionId:undefined, updatedAt:Date.now()};
    await this.state.save(current);
  }
  async clear(host:string){ const current=await this.state.load(); delete current.records[host.toLowerCase()]; await this.state.save(current); }
}
