import { App, Plugin, PluginSettingTab } from "obsidian";
import { startServer, type ServerHandle } from "./server.ts";
import { createVaultService } from "./vault-service.ts";
import { createDefaultPairingStore, type PairingStore } from "./pairing-store.ts";
import { DEFAULT_PORT, ensurePalaceRooms } from "./boot.ts";

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
}

class BridgeSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ObsidianBridgePlugin) {
    super(app, plugin);
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "Obsidian Bridge" });
    containerEl.createEl("p", {
      text: "配对码(10 分钟内有效;重新生成请禁用再启用本插件):",
    });
    containerEl.createEl("pre", { text: this.plugin.pairingCode || "—" });
  }
}
