import type { BrowserBackendType, QualifiedApiMember } from "./api-contract";
import { API_MEMBERS } from "./api-contract";

export type ReadDocument = (name: string) => Promise<string>;

const SAFE_NAME = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/;

export class Documentation {
  constructor(private readonly read: ReadDocument) {}

  async get(name: string): Promise<string> {
    if (!SAFE_NAME.test(name)) {
      throw new Error("Documentation name must be a relative path without an extension.");
    }
    return await this.read(name);
  }
}

const included: Array<{
  name: string;
  browserType?: BrowserBackendType;
  member?: QualifiedApiMember;
}> = [
  { name: "browser-safety" },
  { name: "api-use-behavior" },
  { name: "tab-claiming-chrome", browserType: "extension", member: "BrowserUser.claimTab" },
  { name: "tab-cleanup-chrome", browserType: "extension", member: "Tabs.finalize" },
];

export function formatApiReference(disabledMembers: Set<string>): string {
  const sections = Object.entries(API_MEMBERS).map(([interfaceName, members]) => {
    const visible = members.filter((member) => !disabledMembers.has(`${interfaceName}.${member}`));
    return [
      `## ${interfaceName}`,
      ...visible.map((member) => `- \`${interfaceName}.${member}\``),
    ].join("\n");
  });
  return ["# API Reference", ...sections].join("\n\n");
}

export function formatLookupCatalog(options: {
  browserType: BrowserBackendType;
  disabledMembers: Set<string>;
}): string {
  const entries = [
    { name: "confirmations", description: "read before browser confirmation" },
    { name: "browser-troubleshooting", description: "read after browser interaction failure" },
    ...(!options.disabledMembers.has("PlaywrightFileChooser.setFiles")
      ? [{ name: "file-uploads", description: "read before uploading files" }]
      : []),
    ...(options.browserType === "extension"
      ? [{ name: "chrome-troubleshooting", description: "read after Chrome connection failure" }]
      : []),
  ];
  return entries.map((entry) => `- ${entry.name}: ${entry.description}`).join("\n");
}

export class BrowserDocumentation extends Documentation {
  constructor(private readonly options: {
    api: () => Promise<string>;
    browserType: BrowserBackendType;
    capabilities: { browser: Array<{ id: string }>; tab: Array<{ id: string }> };
    disabledMembers: Set<string>;
    read: ReadDocument;
  }) {
    super(options.read);
  }

  api(): Promise<string> {
    return this.options.api();
  }

  async guidance(): Promise<string> {
    const names = included
      .filter((entry) => !entry.browserType || entry.browserType === this.options.browserType)
      .filter((entry) => !entry.member || !this.options.disabledMembers.has(entry.member))
      .map((entry) => entry.name);
    return (await Promise.all(names.map((name) => this.options.read(name)))).join("\n\n");
  }

  lookupCatalog(): string | undefined {
    const value = formatLookupCatalog(this.options);
    return value || undefined;
  }
}
