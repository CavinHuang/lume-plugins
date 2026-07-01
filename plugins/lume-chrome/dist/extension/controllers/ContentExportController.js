import { evalInPage } from "./PageScript.js";
function htmlToMarkdown(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<h1[^>]*>(.*?)<\/h1>/gis, "# $1\n\n").replace(/<h2[^>]*>(.*?)<\/h2>/gis, "## $1\n\n")
        .replace(/<h3[^>]*>(.*?)<\/h3>/gis, "### $1\n\n").replace(/<li[^>]*>(.*?)<\/li>/gis, "- $1\n")
        .replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n").trim();
}
export class ContentExportController {
    transfer;
    constructor(transfer) {
        this.transfer = transfer;
    }
    async export(tabId, format) {
        const content = await evalInPage(tabId, () => ({ title: document.title, url: location.href, html: document.documentElement.outerHTML, text: document.body?.innerText ?? "" }));
        const body = format === "html" ? content.html : format === "markdown" ? `# ${content.title}\n\nSource: ${content.url}\n\n${htmlToMarkdown(content.html)}` : content.text;
        const ext = format === "markdown" ? "md" : format;
        return this.transfer.writeText(`page-export-${Date.now()}.${ext}`, body, format === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8");
    }
    async exportGsuite(tabId) {
        const data = await evalInPage(tabId, () => {
            const host = location.hostname;
            const title = document.title;
            const candidates = ["[role=textbox]", "[contenteditable=true]", ".kix-appview-editor", ".docs-sheet-grid-container", ".sketchy-content-text"];
            const chunks = [];
            for (const selector of candidates)
                document.querySelectorAll(selector).forEach(el => { const t = el.innerText || el.textContent || ""; if (t.trim())
                    chunks.push(t.trim()); });
            return { host, title, url: location.href, text: Array.from(new Set(chunks)).join("\n\n") || document.body?.innerText || "" };
        });
        return this.transfer.writeText(`gsuite-export-${Date.now()}.md`, `# ${data.title}\n\nSource: ${data.url}\n\n${data.text}`, "text/markdown;charset=utf-8");
    }
}
