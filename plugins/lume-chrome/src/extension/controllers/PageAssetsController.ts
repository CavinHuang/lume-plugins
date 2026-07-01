import { evalInPage } from "./PageScript";
import type { PageAssetInventoryItem, PageAssetBundleResult } from "../../shared/protocol";
import type { AssetTransferController } from "./AssetTransferController";

interface CachedInventory { at:number; items:PageAssetInventoryItem[]; }
export class PageAssetsController {
  private inventories=new Map<number,CachedInventory>();
  constructor(private readonly transfer:AssetTransferController){}
  async list(tabId:number):Promise<PageAssetInventoryItem[]>{
    const items=await evalInPage(tabId,()=>{
      const out:any[]=[];let i=1;const seen=new Set<string>();
      const add=(kind:string,url?:string,extra:any={})=>{const key=`${kind}:${url??extra.label??i}`;if(seen.has(key))return;seen.add(key);out.push({inventoryId:`asset:${i++}`,kind,url,...extra});};
      for(const r of performance.getEntriesByType("resource") as PerformanceResourceTiming[]){const type=r.initiatorType||"other";add(type==="img"?"image":type==="css"||r.name.endsWith(".css")?"stylesheet":type,r.name,{size:r.transferSize||undefined,source:"performance"});}
      document.querySelectorAll("img,source").forEach((el:any)=>add("image",el.currentSrc||el.src,{source:"dom",label:el.alt}));
      document.querySelectorAll("video,audio").forEach((el:any)=>add(el.tagName.toLowerCase(),el.currentSrc||el.src,{source:"dom"}));
      document.querySelectorAll("link[rel=stylesheet]").forEach((el:any)=>add("stylesheet",el.href,{source:"dom"}));
      document.querySelectorAll("script[src]").forEach((el:any)=>add("script",el.src,{source:"dom"}));
      document.querySelectorAll("svg").forEach((el:any,idx)=>add("svg",undefined,{source:"inline",label:`inline-svg-${idx+1}`,inlineContent:el.outerHTML}));
      document.querySelectorAll("*").forEach((el:any)=>{const bg=getComputedStyle(el).backgroundImage;const m=/url\(["']?(.*?)["']?\)/.exec(bg);if(m?.[1])add("image",new URL(m[1],location.href).href,{source:"computed-style",label:"background-image"});});
      return out.slice(0,1500);
    });
    this.inventories.set(tabId,{at:Date.now(),items});return items;
  }
  async bundle(tabId:number,options:{inventoryIds?:string[];kinds?:string[]}={}):Promise<PageAssetBundleResult>{
    const started=Date.now();const inventory=this.inventories.get(tabId)?.items??await this.list(tabId);
    const requested=inventory.filter(x=>(!options.kinds?.length||options.kinds.includes(x.kind))&&(!options.inventoryIds?.length||options.inventoryIds.includes(x.inventoryId)));
    const assets:any[]=[];const failures:any[]=[];
    for(const item of requested){
      try{
        if(item.inlineContent){const result=await this.transfer.writeText(`${item.inventoryId.replace(/:/g,"-")}.svg`,item.inlineContent,"image/svg+xml");assets.push({inventoryId:item.inventoryId,path:result.path,status:"embedded"});continue;}
        if(!item.url)throw new Error("Asset has no URL");
        const response=await fetch(item.url,{credentials:"include"});if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const bytes=new Uint8Array(await response.arrayBuffer());const ext=(new URL(item.url).pathname.split(".").pop()||"bin").replace(/[^a-z0-9]/gi,"").slice(0,8)||"bin";
        const result=await this.transfer.writeBytes(`${item.inventoryId.replace(/:/g,"-")}.${ext}`,bytes,response.headers.get("content-type")||"application/octet-stream");
        assets.push({inventoryId:item.inventoryId,url:item.url,path:result.path,status:"downloaded"});
      }catch(error){const reason=error instanceof Error?error.message:String(error);failures.push({inventoryId:item.inventoryId,reason});assets.push({inventoryId:item.inventoryId,url:item.url,status:"failed",error:reason});}
    }
    const manifest={createdAt:new Date().toISOString(),tabId,assets,failures};const manifestResult=await this.transfer.writeText(`page-assets-manifest-${Date.now()}.json`,JSON.stringify(manifest,null,2),"application/json");
    return{assetId:manifestResult.assetId,path:manifestResult.path,manifestPath:manifestResult.path,itemCount:requested.length,assets,failures,summary:{requestedCount:requested.length,downloadedCount:assets.filter(x=>x.status!=="failed").length,failedCount:failures.length,elapsedMs:Date.now()-started}};
  }
}
