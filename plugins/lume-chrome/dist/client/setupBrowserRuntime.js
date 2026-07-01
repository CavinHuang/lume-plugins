import { BrowserRegistry } from "./BrowserClient.js";
export async function setupBrowserRuntime(options) {
    const agent = { browsers: new BrowserRegistry(options.transport, options.context) };
    if (options.globals) {
        options.globals.agent = agent;
    }
    return { agent };
}
