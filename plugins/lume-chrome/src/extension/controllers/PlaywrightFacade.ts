import { evalInPage } from "./PageScript";
import type { CoordinateElementInfo, DomSnapshot, LocatorState } from "../../shared/protocol";
import type { LocatorAst } from "../../shared/locator";
import type { ChromeDebugger } from "../debugger/ChromeDebugger";

interface ActionOptions { timeoutMs?: number; strict?: boolean; }

async function locatorOperation<T>(tabId:number, ast:LocatorAst, operation:string, payload:any={}):Promise<T>{
  return evalInPage(tabId, async (inputAst, op, p) => {
    type AnyEl = Element & { value?:string; checked?:boolean; disabled?:boolean; click?:()=>void; focus?:()=>void };
    const normalize=(value:string)=>value.replace(/\s+/g," ").trim();
    const textMatches=(actual:string,expected:string,exact=false)=>exact?normalize(actual)===normalize(expected):normalize(actual).toLowerCase().includes(normalize(expected).toLowerCase());
    const visible=(el:Element)=>{const r=(el as HTMLElement).getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden"&&Number(s.opacity||1)>0;};
    const enabled=(el:AnyEl)=>!el.disabled&&el.getAttribute("aria-disabled")!=="true";
    const accessibleName=(el:Element)=>{
      const aria=el.getAttribute("aria-label");if(aria)return aria;
      const labelled=el.getAttribute("aria-labelledby");if(labelled)return labelled.split(/\s+/).map(id=>document.getElementById(id)?.textContent??"").join(" ");
      if((el as HTMLInputElement).labels?.length)return Array.from((el as HTMLInputElement).labels!).map(x=>x.textContent??"").join(" ");
      return el.getAttribute("alt")||el.getAttribute("title")||el.textContent||"";
    };
    const role=(el:Element)=>el.getAttribute("role")||({A:"link",BUTTON:"button",INPUT:(el as HTMLInputElement).type==="checkbox"?"checkbox":(el as HTMLInputElement).type==="radio"?"radio":"textbox",TEXTAREA:"textbox",SELECT:"combobox",IMG:"img",OPTION:"option"} as Record<string,string>)[el.tagName]||"generic";
    const allDesc=(roots:Element[],selector:string)=>roots.flatMap(root=>Array.from(root.querySelectorAll(selector)));
    const unique=(elements:Element[])=>Array.from(new Set(elements));
    const resolveAst=async(input:any):Promise<Element[]>=>{
      let roots:Element[]=[document.documentElement];
      let current:Element[]=[];
      for(const step of input.steps as any[]){
        if(step.kind==="frame"){
          const frames=allDesc(roots,step.selector).filter(e=>e instanceof HTMLIFrameElement) as HTMLIFrameElement[];
          roots=frames.flatMap(f=>{try{return f.contentDocument?.documentElement?[f.contentDocument.documentElement]:[];}catch{return[];}});current=[];continue;
        }
        const scope=current.length?current:roots;
        if(step.kind==="css"||step.kind==="locator") current=allDesc(scope,step.selector);
        else if(step.kind==="role") current=allDesc(scope,"*").filter(el=>role(el)===step.role&&(!step.name||textMatches(accessibleName(el),step.name,step.exact)));
        else if(step.kind==="text") current=allDesc(scope,"*").filter(el=>textMatches(el.textContent||"",step.text,step.exact)&&!Array.from(el.children).some(c=>textMatches(c.textContent||"",step.text,step.exact)));
        else if(step.kind==="label") current=allDesc(scope,"input,textarea,select,button").filter(el=>textMatches(accessibleName(el),step.text,step.exact));
        else if(step.kind==="placeholder") current=allDesc(scope,"[placeholder]").filter(el=>textMatches(el.getAttribute("placeholder")||"",step.text,step.exact));
        else if(step.kind==="testId") current=allDesc(scope,`[data-testid="${CSS.escape(step.testId)}"]`);
        else if(step.kind==="filter") current=current.filter(el=>(!step.hasText||textMatches(el.textContent||"",step.hasText))&&(!step.hasNotText||!textMatches(el.textContent||"",step.hasNotText)));
        else if(step.kind==="first") current=current.slice(0,1);
        else if(step.kind==="last") current=current.slice(-1);
        else if(step.kind==="nth") current=current.slice(step.index,step.index+1);
        else if(step.kind==="and"){const nested=await resolveAst(step.locator);current=current.filter(el=>nested.includes(el));}
        else if(step.kind==="or"){const nested=await resolveAst(step.locator);current=unique([...current,...nested]);}
      }
      return unique(current);
    };
    const current=await resolveAst(inputAst);
    const timeout=Math.max(0,Math.min(Number(p.timeoutMs??5000),30000));
    const waitUntil=async(predicate:()=>boolean)=>{const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)throw new Error(`Locator timed out after ${timeout}ms`);await new Promise(r=>setTimeout(r,100));}};
    if(op==="count")return current.length as any;
    if(op==="allTextContents")return current.map(el=>el.textContent??"") as any;
    if(op==="readAll")return current.slice(0,200).map((el:any)=>({tagName:el.tagName,text:el.innerText||el.textContent||"",href:el.href,value:el.value,ariaLabel:el.getAttribute?.("aria-label"),role:role(el),rect:el.getBoundingClientRect().toJSON?.()??{x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}})) as any;
    if(op==="waitFor"){
      const state=(p.state??"visible") as LocatorState;
      await waitUntil(()=>state==="attached"?current.length>0:state==="detached"?current.length===0:state==="visible"?current.some(visible):current.every(el=>!visible(el)));
      return undefined as any;
    }
    const strict=p.strict!==false;
    if(current.length===0)throw new Error("Locator resolved to no elements");
    if(strict&&current.length!==1)throw new Error(`Strict locator violation: resolved to ${current.length} elements`);
    const el=current[0] as AnyEl;
    if(["actionPoint","click","dblclick","hover","scroll","fill","press","type","selectOption","setChecked","check","uncheck"].includes(op)){
      if(!visible(el))throw new Error("Element is not visible");if(!enabled(el))throw new Error("Element is disabled");
      (el as HTMLElement).scrollIntoView({block:"center",inline:"center"});await new Promise(r=>requestAnimationFrame(()=>r(undefined)));
    }
    if(op==="actionPoint"){const r=(el as HTMLElement).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2} as any;}
    if(op==="click"){(el as HTMLElement).click();return undefined as any;}
    if(op==="dblclick"){el.dispatchEvent(new MouseEvent("dblclick",{bubbles:true,cancelable:true,view:window}));return undefined as any;}
    if(op==="fill"){el.focus?.();if(!("value" in el))throw new Error("Element is not fillable");el.value=String(p.text??"");el.dispatchEvent(new InputEvent("input",{bubbles:true,data:String(p.text??""),inputType:"insertText"}));el.dispatchEvent(new Event("change",{bubbles:true}));return undefined as any;}
    if(op==="press"){el.focus?.();el.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:p.key}));el.dispatchEvent(new KeyboardEvent("keyup",{bubbles:true,key:p.key}));return undefined as any;}
    if(op==="type"){const text=String(p.text??"");el.focus?.();if("value" in el){const input=el as unknown as HTMLInputElement|HTMLTextAreaElement;const start=input.selectionStart??input.value.length;const end=input.selectionEnd??start;input.value=`${input.value.slice(0,start)}${text}${input.value.slice(end)}`;const caret=start+text.length;input.setSelectionRange?.(caret,caret);input.dispatchEvent(new InputEvent("input",{bubbles:true,data:text,inputType:"insertText"}));input.dispatchEvent(new Event("change",{bubbles:true}));return undefined as any;}if((el as HTMLElement).isContentEditable){document.execCommand?.("insertText",false,text);el.dispatchEvent(new InputEvent("input",{bubbles:true,data:text,inputType:"insertText"}));el.dispatchEvent(new Event("change",{bubbles:true}));return undefined as any;}throw new Error("Element is not typeable");}
    if(op==="selectOption"){if(!(el instanceof HTMLSelectElement))throw new Error("Element is not a select");const values=Array.isArray(p.value)?p.value:[p.value];for(const option of Array.from(el.options))option.selected=values.includes(option.value);el.dispatchEvent(new Event("change",{bubbles:true}));return undefined as any;}
    if(op==="setChecked"||op==="check"||op==="uncheck"){if(!("checked" in el))throw new Error("Element is not checkable");el.checked=op==="check"?true:op==="uncheck"?false:Boolean(p.checked);el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));return undefined as any;}
    if(op==="getAttribute")return el.getAttribute(p.name) as any;
    if(op==="innerText")return ((el as HTMLElement).innerText??"") as any;
    if(op==="textContent")return el.textContent as any;
    if(op==="inputValue")return (el.value??"") as any;
    if(op==="isVisible")return visible(el) as any;
    if(op==="isEnabled")return enabled(el) as any;
    if(op==="isChecked")return Boolean(el.checked) as any;
    if(op==="elementInfo"){const r=(el as HTMLElement).getBoundingClientRect();return {tagName:el.tagName,role:role(el),name:accessibleName(el),visible:visible(el),enabled:enabled(el),rect:{x:r.x,y:r.y,width:r.width,height:r.height},attributes:Object.fromEntries(Array.from(el.attributes).map(a=>[a.name,a.value]))} as any;}
    if(op==="mediaUrl"){const media=el as HTMLImageElement|HTMLVideoElement|HTMLAudioElement|HTMLAnchorElement;return ((media as any).currentSrc||(media as any).src||(media as any).href) as any;}
    throw new Error(`Unsupported locator operation: ${op}`);
  }, [ast, operation, payload]);
}

export class PlaywrightFacade {
  constructor(private readonly cdp:ChromeDebugger){}
  async domSnapshot(tabId: number): Promise<DomSnapshot> {
    return evalInPage(tabId, () => ({ url: location.href, title: document.title, html: document.documentElement.outerHTML.slice(0, 1_000_000), text: document.body?.innerText?.slice(0, 200_000) ?? "", truncated: document.documentElement.outerHTML.length > 1_000_000 }));
  }
  async evaluate(tabId: number, expression: string, arg?:unknown) {
    return evalInPage(tabId, (expr,value) => {
      if (/\b(fetch|XMLHttpRequest|indexedDB|localStorage|sessionStorage|document\.cookie|navigator\.sendBeacon|WebSocket)\b/.test(expr)) throw new Error("Expression is outside the read-only evaluate subset");
      return Function("arg", `"use strict"; return (${expr})`)(value);
    }, [expression,arg]);
  }
  operation<T=unknown>(tabId:number,ast:LocatorAst,operation:string,payload:any={}):Promise<T>{return locatorOperation<T>(tabId,ast,operation,payload);}
  async elementScreenshot(tabId:number,ast:LocatorAst,options:any={}){const info=await this.operation<any>(tabId,ast,"elementInfo",options);return this.cdp.screenshot(tabId,{...options,clip:info.rect});}
  async elementInfoAtPoint(tabId:number,options:{x:number;y:number;includeNonInteractable?:boolean}):Promise<CoordinateElementInfo[]>{
    if(!Number.isFinite(options.x)||!Number.isFinite(options.y))throw new Error("playwright.elementInfo requires numeric x and y coordinates");
    return evalInPage(tabId,(x,y,includeNonInteractable)=>{
      type Info = CoordinateElementInfo;
      const normalize=(value:string)=>value.replace(/\s+/g," ").trim();
      const visible=(el:Element)=>{const r=(el as HTMLElement).getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden"&&Number(s.opacity||1)>0;};
      const role=(el:Element)=>el.getAttribute("role")||({A:"link",BUTTON:"button",INPUT:(el as HTMLInputElement).type==="checkbox"?"checkbox":(el as HTMLInputElement).type==="radio"?"radio":"textbox",TEXTAREA:"textbox",SELECT:"combobox",IMG:"img",OPTION:"option"} as Record<string,string>)[el.tagName]||"generic";
      const ariaName=(el:Element)=>el.getAttribute("aria-label")||el.getAttribute("title")||el.getAttribute("alt")||null;
      const escape=(value:string)=>globalThis.CSS?.escape?CSS.escape(value):value.replace(/["\\]/g,"\\$&");
      const selector=(el:Element)=>{const candidates:string[]=[];const id=el.getAttribute("id");const testId=el.getAttribute("data-testid");if(id)candidates.push(`#${escape(id)}`);if(testId)candidates.push(`[data-testid="${escape(testId)}"]`);candidates.push(el.tagName.toLowerCase());return{primary:candidates[0]??null,candidates};};
      const elements=(document.elementsFromPoint?.(x,y)??[document.elementFromPoint(x,y)]).filter((el):el is Element=>el instanceof Element);
      return elements.filter(el=>includeNonInteractable||visible(el)).slice(0,20).map((el):Info=>{const r=(el as HTMLElement).getBoundingClientRect();const tagName=el.tagName.toLowerCase();const visibleText=normalize((el as HTMLElement).innerText||el.textContent||"")||null;return{tagName,nodeId:null,role:role(el),ariaName:ariaName(el),visibleText,preview:normalize(`${tagName} ${visibleText??""}`)||tagName,testId:el.getAttribute("data-testid"),boundingBox:{x:r.x,y:r.y,width:r.width,height:r.height},selector:selector(el)};});
    },[options.x,options.y,options.includeNonInteractable===true]);
  }
  async elementScreenshotAtPoint(tabId:number,options:{x:number;y:number;includeNonInteractable?:boolean}){const info=(await this.elementInfoAtPoint(tabId,options))[0];if(!info?.boundingBox)throw new Error("No element found at coordinate");const overlayId=`lume-element-shot-${Date.now()}-${Math.random().toString(16).slice(2)}`;await evalInPage(tabId,(box,x,y,id)=>{const root=document.createElement("div");root.id=id;Object.assign(root.style,{position:"fixed",left:"0",top:"0",width:"0",height:"0",zIndex:"2147483647",pointerEvents:"none"});const rect=document.createElement("div");Object.assign(rect.style,{position:"fixed",left:`${box.x}px`,top:`${box.y}px`,width:`${box.width}px`,height:`${box.height}px`,border:"2px solid #ff3b30",borderRadius:"6px",boxShadow:"0 0 0 9999px rgba(255,59,48,0.08)"});const dot=document.createElement("div");Object.assign(dot.style,{position:"fixed",left:`${x-5}px`,top:`${y-5}px`,width:"10px",height:"10px",borderRadius:"999px",background:"#ff3b30",boxShadow:"0 0 0 4px rgba(255,59,48,0.25)"});root.append(rect,dot);document.body?.append(root);},[info.boundingBox,options.x,options.y,overlayId]).catch(()=>undefined);try{return await this.cdp.screenshot(tabId,{});}finally{await evalInPage(tabId,(id)=>document.getElementById(id)?.remove(),[overlayId]).catch(()=>undefined);}}
  async waitForURL(tabId:number,url:string,timeoutMs=10_000){const start=Date.now();while(Date.now()-start<timeoutMs){const tab=await chrome.tabs.get(tabId);if(tab.url===url||tab.url?.includes(url))return;await new Promise(r=>setTimeout(r,100));}throw new Error(`Timed out waiting for URL: ${url}`);}
  async waitForLoadState(tabId:number,state="load",timeoutMs=10_000){
    if(state==="networkidle"){await this.cdp.waitForNetworkIdle(tabId,timeoutMs);return;}
    const start=Date.now();while(Date.now()-start<timeoutMs){const tab=await chrome.tabs.get(tabId);if(tab.status==="complete"||state==="domcontentloaded")return;await new Promise(r=>setTimeout(r,100));}throw new Error(`Timed out waiting for load state: ${state}`);
  }
}
