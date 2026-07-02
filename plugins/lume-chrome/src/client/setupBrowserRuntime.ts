import {
  BrowserRegistry,
  refreshBrowserRegistry,
  type BrowserTransport,
} from "./BrowserClient";
import { Documentation, type ReadDocument } from "./documentation";
import type { BrowserContext } from "../shared/protocol";

const BROWSER_RUNTIME = Symbol.for("lume.browser.runtime");

export interface SetupBrowserRuntimeOptions {
  globals?: Record<string, unknown>;
  transport: BrowserTransport;
  readDocument: ReadDocument;
  context?: BrowserContext;
}

export async function setupBrowserRuntime(options: SetupBrowserRuntimeOptions) {
  const globals = options.globals ?? globalThis as unknown as Record<string, unknown>;
  const symbolGlobals = globals as Record<PropertyKey, unknown>;
  const existing = symbolGlobals[BROWSER_RUNTIME];
  if (isBrowserRuntime(existing)) return existing;

  const browsers = options.context
    ? new BrowserRegistry(options.transport, options.context, options.readDocument)
    : new BrowserRegistry(options.transport, options.readDocument);
  const agent = {
    browsers,
    documentation: new Documentation(options.readDocument),
  };
  const runtime = {
    agent,
    refreshBackends: () => refreshBrowserRegistry(browsers),
  };
  symbolGlobals[BROWSER_RUNTIME] = runtime;
  globals.agent = agent;
  return runtime;
}

function isBrowserRuntime(value: unknown): value is {
  agent: { browsers: BrowserRegistry; documentation: Documentation };
  refreshBackends: () => Promise<void>;
} {
  if (!value || typeof value !== "object") return false;
  const runtime = value as { agent?: unknown; refreshBackends?: unknown };
  return !!runtime.agent && typeof runtime.refreshBackends === "function";
}
