const ROOT_ID = "lume-agent-overlay-root";
let root = document.getElementById(ROOT_ID);
if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const shadow = root.attachShadow({ mode: "closed" });
    const cursor = document.createElement("div");
    cursor.id = "cursor";
    cursor.style.cssText = "position:absolute;left:0;top:0;width:22px;height:22px;border-radius:50%;background:#111;box-shadow:0 0 0 2px white,0 4px 18px rgba(0,0,0,.25);transform:translate(-50%,-50%);transition:left .18s ease,top .18s ease;";
    const badge = document.createElement("div");
    badge.id = "badge";
    badge.style.cssText = "position:fixed;right:12px;bottom:12px;padding:6px 9px;border-radius:999px;background:#111;color:white;font:12px system-ui;opacity:.82;";
    badge.textContent = "Lume";
    shadow.append(cursor, badge);
    document.documentElement.appendChild(root);
    window.__lumeOverlay = {
        move(x, y) { cursor.style.left = `${x}px`; cursor.style.top = `${y}px`; setTimeout(() => chrome.runtime.sendMessage({ type: "AGENT_CURSOR_ARRIVED", x, y }).catch(() => undefined), 200); },
        badge(text) { badge.textContent = text; }
    };
}
const observer = new MutationObserver(() => { if (!document.getElementById(ROOT_ID))
    document.documentElement.appendChild(root); });
observer.observe(document.documentElement, { childList: true });
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "LUME_CURSOR_MOVE") {
        window.__lumeOverlay?.move(message.x, message.y);
        setTimeout(() => sendResponse({ ok: true }), 200);
        return true;
    }
    if (message?.type === "TAB_FAVICON_BADGE") {
        window.__lumeOverlay?.badge(message.status ?? "Lume");
    }
    if (message?.type === "CONTENT_PING")
        return { pong: true };
});
export {};
