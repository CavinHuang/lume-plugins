function createDomAgent() {
    const nodes = new Map();
    let seq = 1;
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    const classify = (el) => {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute("role") || (tag === "button" ? "button" : tag === "a" ? "link" : tag === "input" ? "textbox" : undefined);
        const inputLike = ["input", "textarea", "select"].includes(tag) || el.isContentEditable;
        const clickable = tag === "button" || tag === "a" || !!el.getAttribute("onclick") || role === "button";
        return { role, inputLike, clickable };
    };
    function getVisibleDom() {
        nodes.clear();
        seq = 1;
        const candidates = Array.from(document.querySelectorAll("a,button,input,textarea,select,[role],summary,[contenteditable],label,img,video,[onclick]")).filter(visible).slice(0, 1000);
        return candidates.map((el) => { const id = `node:${seq++}`; nodes.set(id, el); const r = el.getBoundingClientRect(); const c = classify(el); return { node_id: id, tagName: el.tagName.toLowerCase(), text: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("alt") || "").slice(0, 300), ariaLabel: el.getAttribute("aria-label") || undefined, href: el.href || undefined, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, ...c }; });
    }
    const get = (id) => { const el = nodes.get(id); if (!el)
        throw new Error(`Unknown node id ${id}. Refresh visible DOM.`); return el; };
    return {
        getVisibleDom,
        click(id) { get(id).click(); },
        doubleClick(id) { get(id).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); },
        type(id, text) { const el = get(id); el.focus?.(); if ("value" in el) {
            el.value = text;
            el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        else {
            document.execCommand?.("insertText", false, text);
        } },
        keypress(id, key) { const el = get(id); el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key })); el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key })); },
        scroll(id, deltaY, deltaX = 0) { if (id)
            get(id).scrollBy({ top: deltaY, left: deltaX, behavior: "smooth" });
        else
            window.scrollBy({ top: deltaY, left: deltaX, behavior: "smooth" }); },
        scrollIntoView(id) { get(id).scrollIntoView({ block: "center", inline: "center" }); },
        mediaUrl(id) { const el = get(id); return el.currentSrc || el.src || el.href || el.querySelector?.("img,video,audio,source")?.currentSrc || el.querySelector?.("img,video,audio,source")?.src; }
    };
}
window.__lumeDomAgent = window.__lumeDomAgent || createDomAgent();
export {};
