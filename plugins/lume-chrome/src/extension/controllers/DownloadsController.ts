import type { DownloadInfo } from "../../shared/protocol";
export class DownloadsController {
  list(query:any={}):Promise<any[]>{return chrome.downloads.search(query);}
  open(downloadId:number):Promise<void>{return chrome.downloads.open(downloadId);}
  remove(downloadId:number):Promise<void>{return chrome.downloads.removeFile(downloadId);}
  path(downloadId:number):Promise<{path?:string}>{return chrome.downloads.search({id:downloadId}).then((items:any[])=>({path:items[0]?.filename}));}
  waitForTab(tabId:number,timeoutMs=20_000):Promise<DownloadInfo>{
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{chrome.downloads.onCreated.removeListener(listener);reject(new Error("Timed out waiting for download"));},timeoutMs);
      const listener=(item:any)=>{if(item.tabId!==undefined&&item.tabId!==tabId)return;clearTimeout(timer);chrome.downloads.onCreated.removeListener(listener);resolve({downloadId:item.id,filename:item.filename,url:item.url,state:item.state});};
      chrome.downloads.onCreated.addListener(listener);
    });
  }
  async downloadUrl(url:string,filename?:string){const id=await chrome.downloads.download({url,filename,saveAs:false});return{id};}
}
