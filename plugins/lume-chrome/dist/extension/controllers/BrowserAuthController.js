export class BrowserAuthController {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async request(chromeTabId, options) {
        if (isExpired(options.expires_at))
            return { status: "expired" };
        const currentOrigin = originOf(await this.deps.tabUrl(chromeTabId));
        if (!currentOrigin)
            return { status: "page_changed" };
        if (currentOrigin !== options.origin)
            return { status: "origin_changed" };
        for (const field of options.fields) {
            if (!await this.deps.validateLocator(chromeTabId, field.selector)) {
                return { status: "locator_invalid" };
            }
        }
        if (options.submit && !await this.deps.validateLocator(chromeTabId, options.submit.selector)) {
            return { status: "locator_invalid" };
        }
        const credentialResponse = await this.deps.requestCredentials(toHostRequest(options));
        if (credentialResponse.status !== "approved") {
            return { status: credentialResponse.status };
        }
        try {
            const values = credentialResponse.values ?? {};
            for (const field of options.fields) {
                await this.deps.fillField(chromeTabId, field.selector, values[field.id] ?? "");
            }
            if (options.submit) {
                if (options.submit.action === "press_enter") {
                    await this.deps.press(chromeTabId, options.submit.selector, "Enter");
                }
                else {
                    await this.deps.click(chromeTabId, options.submit.selector);
                }
            }
            return { status: "submitted" };
        }
        catch {
            return { status: "submission_failed" };
        }
    }
}
function toHostRequest(options) {
    return {
        ...(options.context ? { context: options.context } : {}),
        ...(options.tabId ? { tabId: options.tabId } : {}),
        origin: options.origin,
        reason: options.reason,
        expires_at: options.expires_at,
        fields: options.fields.map(({ id, label, type, autocomplete, required }) => ({
            id,
            label,
            type,
            ...(autocomplete ? { autocomplete } : {}),
            ...(required !== undefined ? { required } : {})
        }))
    };
}
function isExpired(value) {
    const time = Date.parse(value);
    return !Number.isFinite(time) || time <= Date.now();
}
function originOf(url) {
    if (!url)
        return null;
    try {
        return new URL(url).origin;
    }
    catch {
        return null;
    }
}
