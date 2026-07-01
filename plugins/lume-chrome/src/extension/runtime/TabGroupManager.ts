import type { BrowserContext } from "../../shared/protocol";
import { SessionStore } from "./SessionStore";

export class TabGroupManager {
  constructor(private readonly sessions: SessionStore) {}
  async ensureGroup(ctx: BrowserContext, chromeTabId: number, title?: string): Promise<number | undefined> {
    let groupId = await this.sessions.getTabGroup(ctx);
    if (groupId !== undefined) {
      const exists=await chrome.tabGroups.get(groupId).catch(()=>null);
      if(!exists)groupId=undefined;
    }
    if (groupId === undefined) {
      groupId = await chrome.tabs.group({ tabIds: [chromeTabId] }).catch(() => undefined as unknown as number);
      if (groupId !== undefined) {
        await this.sessions.setTabGroup(ctx, groupId);
        await chrome.tabGroups.update(groupId, { title: title ?? "Lume", color: "blue" }).catch(() => undefined);
      }
      return groupId;
    }
    await chrome.tabs.group({ groupId, tabIds: [chromeTabId] }).catch(() => undefined);
    return groupId;
  }
  async name(ctx: BrowserContext, name: string) { const groupId=await this.sessions.getTabGroup(ctx); if(groupId!==undefined)await chrome.tabGroups.update(groupId,{title:name}).catch(()=>undefined); }
  async cleanup(ctx:BrowserContext){const groupId=await this.sessions.getTabGroup(ctx);if(groupId===undefined)return;const tabs=await chrome.tabs.query({groupId});if(!tabs.length)await this.sessions.remove(ctx.browserSessionId);}
}
