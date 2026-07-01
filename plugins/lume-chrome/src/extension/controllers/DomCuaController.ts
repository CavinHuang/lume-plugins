import { injectScript, evalInPage } from "./PageScript";
const DOM_AGENT_FILE="dist/extension/content/dom-agent.js";
export class DomCuaController {
  async ensure(tabId:number){await injectScript(tabId,DOM_AGENT_FILE).catch(()=>undefined);}
  async visibleDom(tabId:number){await this.ensure(tabId);return evalInPage(tabId,()=> (window as any).__lumeDomAgent.getVisibleDom());}
  async click(tabId:number,nodeId:string,double=false){await this.ensure(tabId);return evalInPage(tabId,(id,dbl)=>dbl?(window as any).__lumeDomAgent.doubleClick(id):(window as any).__lumeDomAgent.click(id),[nodeId,double]);}
  async type(tabId:number,nodeId:string,text:string){await this.ensure(tabId);return evalInPage(tabId,(id,t)=>(window as any).__lumeDomAgent.type(id,t),[nodeId,text]);}
  async keypress(tabId:number,nodeId:string,key:string){await this.ensure(tabId);return evalInPage(tabId,(id,k)=>(window as any).__lumeDomAgent.keypress(id,k),[nodeId,key]);}
  async scroll(tabId:number,nodeId:string|undefined,deltaY:number,deltaX=0){await this.ensure(tabId);return evalInPage(tabId,(id,dy,dx)=>(window as any).__lumeDomAgent.scroll(id,dy,dx),[nodeId,deltaY,deltaX]);}
  async mediaUrl(tabId:number,nodeId:string){await this.ensure(tabId);return evalInPage(tabId,(id)=>(window as any).__lumeDomAgent.mediaUrl(id),[nodeId]);}
}
