import { BrowserRegistry, type BrowserTransport } from "./BrowserClient";
import type { BrowserContext } from "../shared/protocol";

export interface SetupBrowserRuntimeOptions {
  globals?: Record<string, unknown>;
  transport: BrowserTransport;
  context: BrowserContext;
}

export async function setupBrowserRuntime(options: SetupBrowserRuntimeOptions) {
  const agent = { browsers: new BrowserRegistry(options.transport, options.context) };
  if (options.globals) {
    options.globals.agent = agent;
  }
  return { agent };
}
