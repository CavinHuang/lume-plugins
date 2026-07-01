import { injectScript, evalInPage } from "./PageScript.js";
const DOM_AGENT_FILE = "dist/extension/content/dom-agent.js";
export class DomCuaController {
    async ensure(tabId) { await injectScript(tabId, DOM_AGENT_FILE).catch(() => undefined); }
    async visibleDom(tabId) { await this.ensure(tabId); return evalInPage(tabId, () => window.__lumeDomAgent.getVisibleDom()); }
    async click(tabId, nodeId, double = false) { await this.ensure(tabId); return evalInPage(tabId, (id, dbl) => dbl ? window.__lumeDomAgent.doubleClick(id) : window.__lumeDomAgent.click(id), [nodeId, double]); }
    async type(tabId, nodeId, text) { await this.ensure(tabId); return evalInPage(tabId, (id, t) => window.__lumeDomAgent.type(id, t), [nodeId, text]); }
    async keypress(tabId, nodeId, key) { await this.ensure(tabId); return evalInPage(tabId, (id, k) => window.__lumeDomAgent.keypress(id, k), [nodeId, key]); }
    async scroll(tabId, nodeId, deltaY, deltaX = 0) { await this.ensure(tabId); return evalInPage(tabId, (id, dy, dx) => window.__lumeDomAgent.scroll(id, dy, dx), [nodeId, deltaY, deltaX]); }
    async mediaUrl(tabId, nodeId) { await this.ensure(tabId); return evalInPage(tabId, (id) => window.__lumeDomAgent.mediaUrl(id), [nodeId]); }
}
