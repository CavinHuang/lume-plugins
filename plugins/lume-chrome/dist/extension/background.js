import { RuntimeDispatcher } from "./runtime/RuntimeDispatcher.js";
import { NativeTransport } from "./runtime/NativeTransport.js";
let dispatcher;
const nativeTransport = new NativeTransport((message) => dispatcher.dispatch(message));
dispatcher = new RuntimeDispatcher(nativeTransport);
void dispatcher.ready().then(() => nativeTransport.start());
chrome.runtime.onInstalled.addListener(() => nativeTransport.connect());
chrome.runtime.onStartup.addListener(() => void dispatcher.ready().then(() => nativeTransport.connect()));
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_NATIVE_HOST_STATUS") {
        sendResponse(nativeTransport.getStatus());
        return true;
    }
    if (message?.type === "RUN_DIAGNOSTICS") {
        void dispatcher.dispatch({ jsonrpc: "2.0", id: `popup-${Date.now()}`, method: "runtime_diagnostics", params: {} }).then((response) => sendResponse(response.result ?? response.error)).catch((error) => sendResponse({ status: "error", lastError: String(error) }));
        return true;
    }
    if (message?.type === "CONTENT_PING") {
        sendResponse({ pong: true });
        return true;
    }
    return false;
});
chrome.tabs.onRemoved.addListener((tabId) => void dispatcher.onTabRemoved(tabId));
chrome.debugger.onDetach.addListener((_source, reason) => void chrome.storage.local.set({ LAST_DEBUGGER_DETACH: { reason, at: Date.now() } }));
