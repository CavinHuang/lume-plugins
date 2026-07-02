import type { LocatorAst } from "./locator";

export const PROTOCOL_VERSION = 5;
export const NATIVE_HOST_PROTOCOL_VERSION = 4;
export const APP_SERVER_PROTOCOL_VERSION = 1;
export const NATIVE_HOST_NAME = "com.lume.browser";

export type BrowserClientType = "extension" | "iab" | "cdp";
export type BrowserVisibility = "visible" | "hidden" | "unknown";
export type FinalizeTabStatus = "handoff" | "deliverable";
export type PermissionState = "granted" | "optional" | "missing" | "denied";
export type FeatureState = "available" | "limited" | "disabled" | "unavailable";
export type LocatorState = "attached" | "detached" | "visible" | "hidden";

export type BrowserCommandType =
  | "runtime_ping" | "runtime_list_browsers" | "runtime_native_status" | "runtime_diagnostics" | "runtime_turn_ended"
  | "browser_documentation" | "browser_name_session" | "browser_auth"
  | "browser_capabilities_list" | "browser_capability_documentation"
  | "browser_user_open_tabs" | "browser_user_claim_tab" | "browser_user_history"
  | "browser_visibility_get" | "browser_visibility_set" | "browser_viewport_set" | "browser_viewport_reset"
  | "browser_site_permissions_list" | "browser_site_permission_set" | "browser_site_permission_clear"
  | "create_tab" | "get_tab" | "selected_tab" | "list_tabs" | "get_session_tabs" | "close_tab"
  | "finalize_tabs" | "release_tabs" | "handoff_tabs" | "resume_handoff_tabs"
  | "navigate_tab_url" | "navigate_tab_back" | "navigate_tab_forward" | "navigate_tab_reload"
  | "tab_id" | "tab_title" | "tab_url" | "tab_screenshot" | "tab_cdp_call" | "tab_cdp_events" | "tab_dev_logs"
  | "tab_clipboard_read" | "tab_clipboard_read_text" | "tab_clipboard_write" | "tab_clipboard_write_text"
  | "tab_browser_auth_handoff" | "tab_content_export" | "tab_content_export_gsuite"
  | "tab_capabilities_list" | "tab_capability_documentation" | "tab_page_assets_list" | "tab_page_assets_bundle"
  | "playwright_dom_snapshot" | "playwright_evaluate" | "playwright_element_info" | "playwright_element_screenshot"
  | "playwright_download_path" | "playwright_wait_for_download" | "playwright_wait_for_file_chooser" | "playwright_file_chooser_set_files"
  | "playwright_wait_for_load_state" | "playwright_wait_for_timeout" | "playwright_wait_for_url" | "playwright_wait_for_selector"
  | "playwright_locator_click" | "playwright_locator_dblclick" | "playwright_locator_fill" | "playwright_locator_press"
  | "playwright_locator_select_option" | "playwright_locator_set_checked" | "playwright_locator_check" | "playwright_locator_uncheck"
  | "playwright_locator_get_attribute" | "playwright_locator_inner_text" | "playwright_locator_text_content" | "playwright_locator_input_value"
  | "playwright_locator_is_visible" | "playwright_locator_is_enabled" | "playwright_locator_is_checked" | "playwright_locator_count"
  | "playwright_locator_all_text_contents" | "playwright_locator_read_all" | "playwright_locator_wait_for" | "playwright_locator_download_media"
  | "dom_cua_get_visible_dom" | "dom_cua_click" | "dom_cua_double_click" | "dom_cua_type" | "dom_cua_keypress" | "dom_cua_scroll" | "dom_cua_download_media"
  | "cua_click" | "cua_double_click" | "cua_move" | "cua_drag" | "cua_scroll" | "cua_type" | "cua_keypress" | "cua_download_media"
  | "downloads_list" | "downloads_open" | "downloads_remove" | "bookmarks_search" | "bookmarks_create" | "reading_list_query" | "top_sites_get" | "sessions_get_recently_closed"
  | "webmcp_list_tools" | "webmcp_invoke_tool"
  | "asset_create" | "asset_append_chunk" | "asset_finish" | "asset_abort" | "asset_remove";

export interface RpcRequest<T = unknown> { jsonrpc: "2.0"; id: string; method: BrowserCommandType | string; params: T; }
export interface RpcNotification<T = unknown> { jsonrpc: "2.0"; method: string; params: T; }
export interface RpcSuccess<T = unknown> { jsonrpc: "2.0"; id: string; result: T; }
export interface RpcFailure { jsonrpc: "2.0"; id: string; error: BrowserRuntimeError; }
export type RpcResponse<T = unknown> = RpcSuccess<T> | RpcFailure;

export interface BrowserRuntimeError { code: string; message: string; details?: unknown; recoverable?: boolean; }
export interface BrowserContext { browserSessionId: string; browserTurnId: string; actor: "agent" | "user"; threadId?: string; }
export interface CapabilityInfo { id: string; name: string; scope: "browser" | "tab"; description: string; state: FeatureState; }

export interface AdvertisedCapability {
  id: string;
  description: string;
}

export interface BrowserBackendDescriptor {
  id: string;
  name: string;
  type: BrowserClientType;
  protocolVersion: number;
  generation: number;
  metadata: Record<string, string>;
  capabilities: {
    browser: AdvertisedCapability[];
    tab: AdvertisedCapability[];
  };
  apiSupportOverrides: Record<string, boolean>;
}

export interface BrowserCapabilities extends BrowserBackendDescriptor {
  browserId: string;
  clientType: BrowserClientType;
  permissions: Record<string, PermissionState>;
  features: Record<string, FeatureState>;
}

export interface FinalizeTabKeep { tabId: string; status: FinalizeTabStatus; reason?: string; }
export interface UserTabInfo { id: string; chromeTabId: number; title?: string; url?: string; lastOpened?: string; tabGroup?: string; active?: boolean; windowId?: number; faviconUrl?: string; }
export interface SessionTabInfo extends UserTabInfo { leaseOwnerSessionId?: string; status?: "active" | "handoff" | "deliverable"; createdByAgent?: boolean; }
export interface Rect { x: number; y: number; width: number; height: number; }
export interface VisibleDomNode { node_id: string; role?: string; tagName: string; text?: string; ariaLabel?: string; rect: Rect; clickable?: boolean; inputLike?: boolean; href?: string; }
export interface DomSnapshot { url: string; title: string; html?: string; text?: string; nodes?: VisibleDomNode[]; truncated?: boolean; }

export interface PageAssetInventoryItem {
  inventoryId: string;
  kind: "image" | "font" | "stylesheet" | "script" | "video" | "audio" | "svg" | "document" | "other" | string;
  url?: string; mimeType?: string; size?: number; source?: "performance" | "dom" | "inline" | "computed-style"; label?: string; inlineContent?: string;
}
export interface PageAssetBundleResult {
  assetId: string; itemCount: number; path?: string; manifestPath?: string;
  assets?: Array<{ inventoryId: string; path?: string; url?: string; status: "downloaded" | "embedded" | "failed"; error?: string }>;
  failures?: Array<{ inventoryId: string; reason: string }>;
  summary?: { requestedCount: number; downloadedCount: number; failedCount: number; elapsedMs: number };
  note?: string;
}

export interface LocatorPayload { locator: LocatorAst; timeoutMs?: number; strict?: boolean; }
export interface FileChooserInfo { chooserId: string; multiple: boolean; accept?: string; }
export interface DownloadInfo { downloadId: number; filename?: string; url?: string; state?: string; path?: string; }
export interface SitePermissionRecord { host: string; decision: "allow_session" | "allow_always" | "block"; sessionId?: string; updatedAt: number; }
export interface DiagnosticsReport { nativeHost: unknown; extension: unknown; permissions: Record<string, PermissionState>; chrome?: unknown; lastErrors?: string[]; persistedState?: unknown; }
