export type BrowserActionKind = "read" | "navigate" | "click" | "type" | "submit" | "download" | "upload" | "history" | "clipboard" | "delete" | "auth" | "finance" | "medical" | "social" | "permission" | "software_install";
export interface BrowserAction { kind: BrowserActionKind; url?: string; host?: string; selector?: string; textPreview?: string; description?: string; source?: "user" | "agent" | "page"; }
export type BrowserPolicyDecision = { kind: "allow"; reason?: string } | { kind: "require_confirmation"; reason: string } | { kind: "handoff_required"; reason: string } | { kind: "deny"; reason: string };

const ALWAYS_CONFIRM = new Set<BrowserActionKind>(["upload", "history", "clipboard", "delete", "auth", "finance", "medical", "social", "permission", "software_install"]);
const HANDOFF = new Set<BrowserActionKind>(["finance", "medical", "software_install"]);

export class BrowserActionPolicy {
  async evaluate(action: BrowserAction): Promise<BrowserPolicyDecision> {
    if (action.source === "page") return { kind: "require_confirmation", reason: "Webpage content cannot authorize browser actions." };
    if (HANDOFF.has(action.kind)) return { kind: "handoff_required", reason: `High-risk browser action must be completed by the user: ${action.kind}` };
    if (ALWAYS_CONFIRM.has(action.kind)) return { kind: "require_confirmation", reason: `Browser action requires explicit user confirmation: ${action.kind}` };
    if (action.kind === "submit") return { kind: "require_confirmation", reason: "Submitting forms can affect external systems." };
    return { kind: "allow" };
  }
}
