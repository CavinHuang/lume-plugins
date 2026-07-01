const ALWAYS_CONFIRM = new Set(["upload", "history", "clipboard", "delete", "auth", "finance", "medical", "social", "permission", "software_install"]);
const HANDOFF = new Set(["finance", "medical", "software_install"]);
export class BrowserActionPolicy {
    async evaluate(action) {
        if (action.source === "page")
            return { kind: "require_confirmation", reason: "Webpage content cannot authorize browser actions." };
        if (HANDOFF.has(action.kind))
            return { kind: "handoff_required", reason: `High-risk browser action must be completed by the user: ${action.kind}` };
        if (ALWAYS_CONFIRM.has(action.kind))
            return { kind: "require_confirmation", reason: `Browser action requires explicit user confirmation: ${action.kind}` };
        if (action.kind === "submit")
            return { kind: "require_confirmation", reason: "Submitting forms can affect external systems." };
        return { kind: "allow" };
    }
}
