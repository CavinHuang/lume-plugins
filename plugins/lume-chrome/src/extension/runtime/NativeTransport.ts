import { NATIVE_HOST_NAME } from "../../shared/protocol";
import type { RpcRequest, RpcResponse } from "../../shared/protocol";

export type NativeStatus = "connected" | "disconnected" | "reconnecting";
type Pending = { resolve:(value:unknown)=>void; reject:(error:Error)=>void; timer:number };

export class NativeTransport {
  private port: chrome.runtime.Port | null = null;
  private status: NativeStatus = "disconnected";
  private reconnectAlarm = "lume-native-transport-reconnect";
  private pending = new Map<string, Pending>();
  private seq = 1;
  private generation = 0;
  constructor(private readonly onMessage: (message: RpcRequest) => Promise<RpcResponse>) {}
  getStatus() { return { status: this.status, host: NATIVE_HOST_NAME, connected: this.port !== null, updatedAt: Date.now() }; }
  connectionGeneration() { return this.generation; }
  start() {
    chrome.alarms.onAlarm.addListener((a:any) => { if (a.name === this.reconnectAlarm && !this.port) this.connect(); });
    this.connect();
  }
  connect() {
    if (this.port) return;
    try {
      this.port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      this.generation += 1;
      this.status = "connected";
      void chrome.storage.local.set({ NATIVE_HOST_STATUS: this.getStatus() });
      this.port.onMessage.addListener((message:any) => void this.handleIncoming(message));
      this.port.onDisconnect.addListener(() => this.handleDisconnect());
      void this.requestHost("host.hello", { extensionId: chrome.runtime.id, extensionVersion: chrome.runtime.getManifest().version }, 5_000).catch(()=>undefined);
    } catch (error) {
      this.status = "disconnected";
      void chrome.storage.local.set({ NATIVE_HOST_STATUS: { ...this.getStatus(), lastError: String(error) } });
      chrome.alarms.create(this.reconnectAlarm, { delayInMinutes: 0.08 });
    }
  }
  async requestHost<T=unknown>(method:string, params:unknown, timeoutMs=30_000):Promise<T>{
    if(!this.port) this.connect();
    if(!this.port) throw new Error("Native host is not connected");
    const id=`ext-${Date.now()}-${this.seq++}`;
    return new Promise<T>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id); reject(new Error(`Native host request timed out: ${method}`));}, timeoutMs) as unknown as number;
      this.pending.set(id,{resolve:resolve as (v:unknown)=>void,reject,timer});
      this.port!.postMessage({jsonrpc:"2.0",id,method,params});
    });
  }
  notifyHost(method:string,params:unknown){ this.port?.postMessage({jsonrpc:"2.0",method,params}); }
  private async handleIncoming(message:any){
    if(message?.id && ("result" in message || "error" in message)){
      const pending=this.pending.get(String(message.id)); if(!pending)return;
      clearTimeout(pending.timer); this.pending.delete(String(message.id));
      if(message.error) pending.reject(Object.assign(new Error(message.error.message??"Native host error"),{code:message.error.code,details:message.error.details}));
      else pending.resolve(message.result);
      return;
    }
    if(message?.id && message?.method){
      const response=await this.onMessage(message as RpcRequest);
      this.port?.postMessage(response);
    }
  }
  private handleDisconnect(){
    const lastError=chrome.runtime.lastError?.message;
    this.port=null; this.status="reconnecting";
    for(const [id,p] of this.pending){clearTimeout(p.timer);p.reject(new Error(`Native host disconnected during request ${id}`));}
    this.pending.clear();
    void chrome.storage.local.set({NATIVE_HOST_STATUS:{...this.getStatus(),lastError}});
    chrome.alarms.create(this.reconnectAlarm,{delayInMinutes:0.08});
  }
}
