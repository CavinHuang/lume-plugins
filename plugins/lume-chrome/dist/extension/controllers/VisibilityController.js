export class VisibilityController {
    async get() { const windows = await chrome.windows.getAll({ populate: false }); return { visibility: windows.some(w => w.focused) ? "visible" : "unknown", windows: windows.length }; }
    async set(visibility) {
        if (visibility === "visible") {
            const win = await chrome.windows.getCurrent().catch(() => null);
            if (win?.id)
                await chrome.windows.update(win.id, { focused: true });
        }
        return { visibility };
    }
}
