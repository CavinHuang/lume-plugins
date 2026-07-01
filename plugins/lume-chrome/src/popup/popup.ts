async function refresh() {
  const status = await chrome.runtime.sendMessage({ type: "GET_NATIVE_HOST_STATUS" }).catch(e => ({ status: "error", lastError: String(e) }));
  document.getElementById("status")!.textContent = status.status ?? "unknown";
  document.getElementById("host")!.textContent = `Native host: ${status.host ?? "com.lume.browser"}`;
  document.getElementById("details")!.textContent = JSON.stringify(status, null, 2);
}
document.getElementById("open-settings")?.addEventListener("click", () => chrome.tabs.create({ url: "lume://settings/browser" }));
document.getElementById("diagnose")?.addEventListener("click", refresh);
void refresh();
