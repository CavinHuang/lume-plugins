import { BrowserActionPolicy } from "../../policy/BrowserActionPolicy.js";
export class ConfirmationClient {
    native;
    permissions;
    policy = new BrowserActionPolicy();
    constructor(native, permissions) {
        this.native = native;
        this.permissions = permissions;
    }
    async ensureAllowed(action, context) {
        const host = action.host ?? (action.url ? new URL(action.url).host : undefined);
        if (host) {
            const site = await this.permissions.get(host, context);
            if (site?.decision === "block")
                throw new Error(`Browser access is blocked for ${host}`);
            if (site?.decision === "allow_always" || site?.decision === "allow_session")
                return;
        }
        if (host) {
            const response = await this.native.requestHost("host.confirmation.request", { action, context, reason: `Allow Lume to interact with ${host}?`, kind: "site_access" });
            if (!response.approved)
                throw Object.assign(new Error(`Browser access was not approved for ${host}`), { code: "E_USER_DECLINED" });
            await this.permissions.set(host, response.remember === "always" ? "allow_always" : response.remember === "block" ? "block" : "allow_session", context);
            if (response.remember === "block")
                throw new Error(`Browser access is blocked for ${host}`);
        }
        const decision = await this.policy.evaluate(action);
        if (decision.kind === "allow")
            return;
        if (decision.kind === "deny")
            throw new Error(`Browser action denied: ${decision.reason}`);
        if (decision.kind === "handoff_required")
            throw Object.assign(new Error(decision.reason), { code: "E_USER_HANDOFF_REQUIRED" });
        const response = await this.native.requestHost("host.confirmation.request", { action, context, reason: decision.reason });
        if (!response.approved)
            throw Object.assign(new Error("User declined browser action"), { code: "E_USER_DECLINED" });
        if (host && response.remember)
            await this.permissions.set(host, response.remember === "always" ? "allow_always" : response.remember === "block" ? "block" : "allow_session", context);
    }
}
