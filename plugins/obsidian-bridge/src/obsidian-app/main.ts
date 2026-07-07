import { App, Notice, Plugin, PluginSettingTab } from "obsidian";
import { startServer, type ServerHandle } from "./server.ts";
import { createVaultService } from "./vault-service.ts";
import { createDefaultPairingStore, type PairingStore } from "./pairing-store.ts";
import { DEFAULT_PORT, ensurePalaceRooms } from "./boot.ts";
import { formatPairingCode } from "./pairing-ui.ts";

export default class ObsidianBridgePlugin extends Plugin {
  private server?: ServerHandle;
  private pairing?: PairingStore;
  pairingCode = "";

  async onload() {
    const pairing = createDefaultPairingStore();
    this.pairing = pairing;
    this.pairingCode = pairing.generateCode();

    await ensurePalaceRooms(this.app);

    this.server = startServer({
      port: DEFAULT_PORT,
      vault: createVaultService(this.app as unknown as Parameters<typeof createVaultService>[0]),
      pairing,
      vaultName: this.app.vault.getName(),
      appVersion: this.manifest.version,
      getRoomMarkdown: async (room) => {
        const f = this.app.vault.getAbstractFileByPath(`palace/${room}.md`);
        return f ? await this.app.vault.read(f as never) : "## 触发场景\n(空房间)\n";
      },
    });

    this.addSettingTab(new BridgeSettingTab(this.app, this));
  }

  onunload() {
    this.server?.close();
  }

  regeneratePairingCode(): string {
    if (!this.pairing) {
      return "";
    }

    this.pairingCode = this.pairing.generateCode();
    return this.pairingCode;
  }
}

class BridgeSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ObsidianBridgePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Obsidian Bridge" });
    const description = containerEl.createEl("p", {
      text: "让 Lume 安全连接当前 Vault。",
    });
    description.style.color = "var(--text-muted)";

    this.renderPairingPanel(containerEl);
  }

  private renderPairingPanel(containerEl: HTMLElement): void {
    const panel = containerEl.createDiv();
    panel.style.background = "var(--background-secondary)";
    panel.style.border = "1px solid var(--background-modifier-border)";
    panel.style.borderRadius = "8px";
    panel.style.padding = "18px";
    panel.style.maxWidth = "560px";

    const statusLabel = panel.createEl("div", { text: "状态" });
    statusLabel.style.fontWeight = "600";
    statusLabel.style.marginBottom = "8px";

    const statusRow = panel.createDiv();
    statusRow.style.display = "flex";
    statusRow.style.alignItems = "center";
    statusRow.style.gap = "8px";
    statusRow.style.marginBottom = "18px";

    const statusDot = statusRow.createSpan({ text: "●" });
    statusDot.style.color = "var(--text-accent)";
    statusRow.createSpan({ text: `本地服务运行中  127.0.0.1:${DEFAULT_PORT}` });

    this.renderCodeRow(panel, this.plugin.pairingCode);

    const hint = panel.createEl("p", {
      text: "10 分钟内有效。复制后回到 Lume 对话发送。",
    });
    hint.style.color = "var(--text-muted)";
    hint.style.marginTop = "10px";
    hint.style.marginBottom = "16px";

    const regenerateButton = panel.createEl("button", { text: "重新生成配对码" });
    regenerateButton.addEventListener("click", () => {
      this.plugin.regeneratePairingCode();
      new Notice("已生成新的配对码");
      this.display();
    });
  }

  private renderCodeRow(parent: HTMLElement, code: string): void {
    const codeLabel = parent.createEl("div", { text: "配对码" });
    codeLabel.style.fontWeight = "600";
    codeLabel.style.marginBottom = "8px";

    const codeRow = parent.createDiv();
    codeRow.style.display = "flex";
    codeRow.style.alignItems = "stretch";
    codeRow.style.flexWrap = "wrap";
    codeRow.style.gap = "10px";

    const codeBox = codeRow.createDiv();
    codeBox.style.background = "var(--background-primary)";
    codeBox.style.border = "1px solid var(--background-modifier-border)";
    codeBox.style.borderRadius = "8px";
    codeBox.style.fontFamily = "var(--font-monospace)";
    codeBox.style.fontSize = "32px";
    codeBox.style.fontWeight = "700";
    codeBox.style.letterSpacing = "0";
    codeBox.style.lineHeight = "1";
    codeBox.style.minWidth = "220px";
    codeBox.style.padding = "16px 22px";
    codeBox.style.textAlign = "center";
    codeBox.style.userSelect = "text";
    codeBox.setText(formatPairingCode(code));

    const copyButton = codeRow.createEl("button", { text: "复制", cls: "mod-cta" });
    copyButton.disabled = !code;
    copyButton.addEventListener("click", () => {
      void this.copyPairingCode(code, copyButton);
    });
  }

  private async copyPairingCode(code: string, button: HTMLButtonElement): Promise<void> {
    try {
      await copyTextToClipboard(code);
      new Notice("配对码已复制");
      const previousText = button.textContent ?? "复制";
      button.textContent = "已复制";
      window.setTimeout(() => {
        button.textContent = previousText;
      }, 1200);
    } catch {
      new Notice("复制失败，请手动复制配对码");
    }
  }
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the textarea path below for Obsidian desktop permission quirks.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.left = "-9999px";
  textarea.style.position = "fixed";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("copy_failed");
    }
  } finally {
    textarea.remove();
  }
}
