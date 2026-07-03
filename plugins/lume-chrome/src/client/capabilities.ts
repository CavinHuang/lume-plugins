import type {
  AdvertisedCapability, BotDetectionReason, BrowserCommandType, CdpReadEventsResult
} from "../shared/protocol";
import type { BrowserTransport } from "./BrowserClient";

interface CapabilityContext {
  browserId: string;
  tabId?: string;
  transport: BrowserTransport;
}

export interface CapabilityDefinition {
  id: string;
  scope: "browser" | "tab";
  create(context: CapabilityContext): object;
}

export class DocumentedCapability {
  constructor(
    protected readonly context: CapabilityContext,
    private readonly id: string,
    private readonly scope: "browser" | "tab",
  ) {}

  documentation(): Promise<string> {
    const method: BrowserCommandType = this.scope === "browser"
      ? "browser_capability_documentation"
      : "tab_capability_documentation";
    return this.context.transport.send(method, {
      browserId: this.context.browserId,
      ...(this.context.tabId ? { tabId: this.context.tabId } : {}),
      capabilityId: this.id,
    });
  }
}

export class VisibilityCapability extends DocumentedCapability {
  get(): Promise<boolean> {
    return this.context.transport.send("browser_visibility_get", {
      browserId: this.context.browserId,
    });
  }

  set(visible: boolean): Promise<void> {
    return this.context.transport.send("browser_visibility_set", {
      browserId: this.context.browserId,
      visible,
    });
  }
}

export class ViewportCapability extends DocumentedCapability {
  set(options: { width: number; height: number }): Promise<void> {
    return this.context.transport.send("browser_viewport_set", {
      browserId: this.context.browserId,
      options,
    });
  }

  reset(): Promise<void> {
    return this.context.transport.send("browser_viewport_reset", {
      browserId: this.context.browserId,
    });
  }
}

export class PageAssetsCapability extends DocumentedCapability {
  list(): Promise<unknown> {
    return this.context.transport.send("tab_page_assets_list", {
      browserId: this.context.browserId,
      tabId: this.context.tabId,
    });
  }

  bundle(options: unknown): Promise<unknown> {
    return this.context.transport.send("tab_page_assets_bundle", {
      browserId: this.context.browserId,
      tabId: this.context.tabId,
      options,
    });
  }
}

export class CdpCapability extends DocumentedCapability {
  send(method: string, params: Record<string, unknown> = {}, options: { timeoutMs?: number } = {}): Promise<unknown> {
    return this.context.transport.send("tab_cdp_send", {
      browserId: this.context.browserId,
      tabId: this.context.tabId,
      method,
      params,
      options,
    });
  }

  readEvents(options: { afterSequence?: number; limit?: number; methods?: string[]; timeoutMs?: number } = {}): Promise<CdpReadEventsResult> {
    return this.context.transport.send("tab_cdp_read_events", {
      browserId: this.context.browserId,
      tabId: this.context.tabId,
      options,
    });
  }
}

export class BotDetectionCapability extends DocumentedCapability {
  report(options: { reason: BotDetectionReason }): Promise<{ hostname: string | null; status: "reported" }> {
    return this.context.transport.send("tab_bot_detection_report", {
      browserId: this.context.browserId,
      tabId: this.context.tabId,
      reason: options.reason,
    });
  }
}

export function createCapabilityDefinitions(): Map<string, CapabilityDefinition> {
  const definitions: CapabilityDefinition[] = [
    {
      id: "visibility",
      scope: "browser",
      create: (context) => new VisibilityCapability(context, "visibility", "browser"),
    },
    {
      id: "viewport",
      scope: "browser",
      create: (context) => new ViewportCapability(context, "viewport", "browser"),
    },
    {
      id: "pageAssets",
      scope: "tab",
      create: (context) => new PageAssetsCapability(context, "pageAssets", "tab"),
    },
    {
      id: "cdp",
      scope: "tab",
      create: (context) => new CdpCapability(context, "cdp", "tab"),
    },
    {
      id: "botDetection",
      scope: "tab",
      create: (context) => new BotDetectionCapability(context, "botDetection", "tab"),
    },
  ];
  return new Map(definitions.map((definition) => [definition.id, definition]));
}

export class CapabilityCollection {
  constructor(private readonly options: {
    advertised: AdvertisedCapability[];
    browserId: string;
    definitions: Map<string, CapabilityDefinition>;
    scope: "browser" | "tab";
    tabId?: string;
    transport: BrowserTransport;
  }) {}

  async list(): Promise<AdvertisedCapability[]> {
    return this.options.advertised.filter((item) => {
      const definition = this.options.definitions.get(item.id);
      return definition?.scope === this.options.scope;
    });
  }

  async get(id: string): Promise<any> {
    const advertised = (await this.list()).some((item) => item.id === id);
    const definition = this.options.definitions.get(id);
    if (!advertised || !definition || definition.scope !== this.options.scope) {
      throw new Error(`Capability not available: ${id}`);
    }
    return definition.create({
      browserId: this.options.browserId,
      tabId: this.options.tabId,
      transport: this.options.transport,
    });
  }
}
