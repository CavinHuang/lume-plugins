import type {
  BrowserAuthRequestOptions,
  BrowserAuthResult,
  BrowserAuthSelector,
  BrowserAuthStatus,
  BrowserContext
} from "../../shared/protocol";

export interface BrowserAuthCredentialResponse {
  status: "approved" | Exclude<BrowserAuthStatus, "submitted">;
  values?: Record<string, string>;
}

export interface BrowserAuthControllerDeps {
  tabUrl(tabId: number): Promise<string | undefined>;
  requestCredentials(request: BrowserAuthHostRequest): Promise<BrowserAuthCredentialResponse>;
  validateLocator(tabId: number, selector: BrowserAuthSelector): Promise<boolean>;
  fillField(tabId: number, selector: BrowserAuthSelector, value: string): Promise<void>;
  click(tabId: number, selector: BrowserAuthSelector): Promise<void>;
  press(tabId: number, selector: BrowserAuthSelector, key: string): Promise<void>;
}

export interface BrowserAuthHostRequest {
  context?: BrowserContext;
  tabId?: string;
  origin: string;
  reason?: string;
  expires_at: string;
  fields: Array<{
    id: string;
    label: string;
    type: string;
    autocomplete?: string;
    required?: boolean;
  }>;
}

export class BrowserAuthController {
  constructor(private readonly deps: BrowserAuthControllerDeps) {}

  async request(
    chromeTabId: number,
    options: BrowserAuthRequestOptions & { context?: BrowserContext; tabId?: string }
  ): Promise<BrowserAuthResult> {
    if (isExpired(options.expires_at)) return { status: "expired" };
    const currentOrigin = originOf(await this.deps.tabUrl(chromeTabId));
    if (!currentOrigin) return { status: "page_changed" };
    if (currentOrigin !== options.origin) return { status: "origin_changed" };

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
        } else {
          await this.deps.click(chromeTabId, options.submit.selector);
        }
      }
      return { status: "submitted" };
    } catch {
      return { status: "submission_failed" };
    }
  }
}

function toHostRequest(options: BrowserAuthRequestOptions & { context?: BrowserContext; tabId?: string }): BrowserAuthHostRequest {
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

function isExpired(value: string): boolean {
  const time = Date.parse(value);
  return !Number.isFinite(time) || time <= Date.now();
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
