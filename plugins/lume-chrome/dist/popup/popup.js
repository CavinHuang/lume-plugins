export function buildPopupViewModel(rawStatus) {
    const status = String(rawStatus?.status ?? "unknown");
    const diagnostics = rawStatus?.diagnostics ?? rawStatus?.diagnosticsReport ?? {};
    const permissions = diagnostics?.permissions ?? rawStatus?.permissions ?? {};
    const capabilities = diagnostics?.capabilities ?? rawStatus?.capabilities ?? {};
    const connected = rawStatus?.connected === true || status === "connected";
    const tone = connected ? "ok" : status === "reconnecting" ? "warn" : "error";
    return {
        tone,
        statusLabel: statusLabel(status, connected),
        hostLabel: String(rawStatus?.host ?? "com.lume.browser"),
        summary: connected
            ? "Native host connected. Browser automation is available."
            : status === "reconnecting"
                ? "Native host is reconnecting. Run diagnostics if this does not recover."
                : "Native host is not connected. Open Lume settings to repair the bridge.",
        primaryActionLabel: connected ? "Run diagnostics" : "Run diagnostics",
        permissionCards: Object.entries(permissions).map(([id, state]) => ({
            id,
            label: labelize(id),
            state: String(state),
        })),
        capabilityCards: [
            ...(capabilities.browser ?? []),
            ...(capabilities.tab ?? []),
        ].map((item) => ({
            id: String(item.id),
            label: labelize(String(item.id)),
            state: "available",
        })),
        detailsText: JSON.stringify(redact(rawStatus), null, 2),
    };
}
async function refresh() {
    const status = await chrome.runtime
        .sendMessage({ type: "GET_NATIVE_HOST_STATUS" })
        .catch((error) => ({ status: "error", lastError: String(error) }));
    const diagnostics = await chrome.runtime
        .sendMessage({ type: "RUN_DIAGNOSTICS" })
        .catch(() => null);
    render(buildPopupViewModel({ ...status, ...(diagnostics ? { diagnostics } : {}) }));
}
function render(model) {
    text("status", model.statusLabel);
    text("host", model.hostLabel);
    text("summary", model.summary);
    text("primary-action", model.primaryActionLabel);
    const status = document.getElementById("status");
    status?.setAttribute("data-tone", model.tone);
    renderCards("permissions", model.permissionCards);
    renderCards("capabilities", model.capabilityCards);
    text("details", model.detailsText);
}
function renderCards(id, cards) {
    const root = document.getElementById(id);
    if (!root)
        return;
    root.textContent = "";
    for (const card of cards) {
        const item = document.createElement("div");
        item.className = "card";
        item.innerHTML = `<span>${escapeHtml(card.label)}</span><strong>${escapeHtml(card.state)}</strong>`;
        root.append(item);
    }
}
function text(id, value) {
    const el = document.getElementById(id);
    if (el)
        el.textContent = value;
}
function statusLabel(status, connected) {
    if (connected)
        return "Connected";
    if (status === "reconnecting")
        return "Reconnecting";
    if (status === "disconnected")
        return "Disconnected";
    if (status === "error")
        return "Error";
    return "Unknown";
}
function labelize(value) {
    return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ");
}
function redact(value) {
    if (Array.isArray(value))
        return value.map(redact);
    if (!value || typeof value !== "object")
        return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        /password|token|secret|cookie|authorization/i.test(key) ? "[redacted]" : redact(item),
    ]));
}
function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;",
    }[char] ?? char));
}
if (typeof document !== "undefined") {
    document.getElementById("open-settings")?.addEventListener("click", () => chrome.tabs.create({ url: "lume://settings/browser" }));
    document.getElementById("diagnose")?.addEventListener("click", refresh);
    document.getElementById("copy-details")?.addEventListener("click", async () => {
        const details = document.getElementById("details")?.textContent ?? "";
        await navigator.clipboard?.writeText(details).catch(() => undefined);
    });
    void refresh();
}
