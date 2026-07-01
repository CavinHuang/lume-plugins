export class DownloadsController {
    list(query = {}) { return chrome.downloads.search(query); }
    open(downloadId) { return chrome.downloads.open(downloadId); }
    remove(downloadId) { return chrome.downloads.removeFile(downloadId); }
    path(downloadId) { return chrome.downloads.search({ id: downloadId }).then((items) => ({ path: items[0]?.filename })); }
    waitForTab(tabId, timeoutMs = 20_000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { chrome.downloads.onCreated.removeListener(listener); reject(new Error("Timed out waiting for download")); }, timeoutMs);
            const listener = (item) => { if (item.tabId !== undefined && item.tabId !== tabId)
                return; clearTimeout(timer); chrome.downloads.onCreated.removeListener(listener); resolve({ downloadId: item.id, filename: item.filename, url: item.url, state: item.state }); };
            chrome.downloads.onCreated.addListener(listener);
        });
    }
    async downloadUrl(url, filename) { const id = await chrome.downloads.download({ url, filename, saveAs: false }); return { id }; }
}
