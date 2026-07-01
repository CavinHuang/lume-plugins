export async function injectScript(chromeTabId, file) {
    await chrome.scripting.executeScript({ target: { tabId: chromeTabId }, files: [file] });
}
export async function evalInPage(chromeTabId, func, args = [], world = "MAIN") {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: chromeTabId }, func, args, world });
    return await result.result;
}
