import type { NativeTransport } from "../runtime/NativeTransport";
import type { ChromeDebugger } from "../debugger/ChromeDebugger";
export class CdpEventController {
  private subscriptions=new Map<number,Set<string>>();
  constructor(private readonly native:NativeTransport,private readonly cdp:ChromeDebugger){
    chrome.debugger.onEvent.addListener((source:any,method:string,params:any)=>{
      if(typeof source.tabId!=="number")return; const set=this.subscriptions.get(source.tabId); if(!set?.has(method))return;
      this.native.notifyHost("browser.cdp.event",{chromeTabId:source.tabId,method,params,at:Date.now()});
    });
  }
  async subscribe(tabId:number,events:string[]){await this.cdp.ensureAttached(tabId);this.subscriptions.set(tabId,new Set(events));for(const domain of new Set(events.map(e=>e.split(".")[0]))){await this.cdp.send(tabId,`${domain}.enable`,{}, {allowMutating:true}).catch(()=>undefined);}}
  cleanup(tabId:number){this.subscriptions.delete(tabId);}
}
