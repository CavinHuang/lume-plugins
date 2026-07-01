declare global { interface Window { __lumeDomAgent?: ReturnType<typeof createDomAgent>; } }

function createDomAgent() {
  const nodes = new Map<string, Element>();
  let seq = 1;
  const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const cs = getComputedStyle(el as HTMLElement); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const classify = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || (tag === "button" ? "button" : tag === "a" ? "link" : tag === "input" ? "textbox" : undefined);
    const inputLike = ["input", "textarea", "select"].includes(tag) || (el as HTMLElement).isContentEditable;
    const clickable = tag === "button" || tag === "a" || !!el.getAttribute("onclick") || role === "button";
    return { role, inputLike, clickable };
  };
  function getVisibleDom() {
    nodes.clear(); seq = 1;
    const candidates = Array.from(document.querySelectorAll("a,button,input,textarea,select,[role],summary,[contenteditable],label,img,video,[onclick]")).filter(visible).slice(0, 1000);
    return candidates.map((el) => { const id = `node:${seq++}`; nodes.set(id, el); const r = (el as HTMLElement).getBoundingClientRect(); const c = classify(el); return { node_id: id, tagName: el.tagName.toLowerCase(), text: ((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.getAttribute("alt") || "").slice(0, 300), ariaLabel: el.getAttribute("aria-label") || undefined, href: (el as HTMLAnchorElement).href || undefined, rect: { x:r.x, y:r.y, width:r.width, height:r.height }, ...c }; });
  }
  const get = (id:string) => { const el = nodes.get(id); if (!el) throw new Error(`Unknown node id ${id}. Refresh visible DOM.`); return el as HTMLElement; };
  return {
    getVisibleDom,
    click(id:string) { get(id).click(); },
    doubleClick(id:string) { get(id).dispatchEvent(new MouseEvent("dblclick", { bubbles:true })); },
    type(id:string, text:string) { const el:any = get(id); el.focus?.(); if ("value" in el) { el.value = text; el.dispatchEvent(new InputEvent("input", { bubbles:true, data:text, inputType:"insertText" })); el.dispatchEvent(new Event("change", { bubbles:true })); } else { document.execCommand?.("insertText", false, text); } },
    keypress(id:string, key:string) { const el = get(id); el.dispatchEvent(new KeyboardEvent("keydown", { bubbles:true, key })); el.dispatchEvent(new KeyboardEvent("keyup", { bubbles:true, key })); },
    scroll(id:string|undefined, deltaY:number, deltaX=0) { if(id) get(id).scrollBy({ top: deltaY, left: deltaX, behavior: "smooth" }); else window.scrollBy({ top: deltaY, left: deltaX, behavior: "smooth" }); },
    scrollIntoView(id:string) { get(id).scrollIntoView({ block:"center", inline:"center" }); },
    mediaUrl(id:string) { const el:any=get(id); return el.currentSrc || el.src || el.href || el.querySelector?.("img,video,audio,source")?.currentSrc || el.querySelector?.("img,video,audio,source")?.src; }
  };
}
window.__lumeDomAgent = window.__lumeDomAgent || createDomAgent();
export {};
