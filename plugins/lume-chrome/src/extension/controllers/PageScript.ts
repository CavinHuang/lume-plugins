export async function injectScript(chromeTabId: number, file: string) {
  await chrome.scripting.executeScript({ target: { tabId: chromeTabId }, files: [file] });
}

export async function evalInPage<T>(chromeTabId: number, func: (...args: any[]) => T | Promise<T>, args: any[] = [], world: chrome.scripting.ExecutionWorld = "MAIN"): Promise<T> {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: chromeTabId }, func, args, world });
  return await result.result as T;
}
