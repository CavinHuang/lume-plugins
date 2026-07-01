import { evalInPage } from "./PageScript";
export class ClipboardController {
  readText(tabId:number):Promise<string>{ return evalInPage(tabId,()=>navigator.clipboard.readText()); }
  writeText(tabId:number,text:string):Promise<void>{ return evalInPage(tabId,(value)=>navigator.clipboard.writeText(value),[text]); }
  async read(tabId:number){
    return evalInPage(tabId,async()=>{
      const items=await navigator.clipboard.read(); const out:any[]=[];
      for(const item of items){for(const type of item.types){const blob=await item.getType(type);out.push({type,size:blob.size,text:type.startsWith("text/")?await blob.text():undefined});}}
      return out;
    });
  }
  async write(tabId:number,data:any){
    if(typeof data==="string") return this.writeText(tabId,data);
    return evalInPage(tabId,async(payload)=>{
      if(payload?.text) await navigator.clipboard.writeText(String(payload.text)); else throw new Error("Only text clipboard writes are enabled in this reference runtime");
    },[data]);
  }
}
