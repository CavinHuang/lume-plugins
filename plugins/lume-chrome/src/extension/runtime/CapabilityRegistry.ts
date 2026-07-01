import type { CapabilityInfo } from "../../shared/protocol";

const BROWSER_CAPABILITIES:CapabilityInfo[]=[
  {id:"userContext",name:"User browser context",scope:"browser",description:"List and claim open user tabs and request recent history.",state:"available"},
  {id:"sitePermissions",name:"Site permissions",scope:"browser",description:"Session and persistent host allow/block decisions.",state:"available"},
  {id:"tabGroups",name:"Tab groups",scope:"browser",description:"Group tabs by browser session and preserve deliverables/handoffs.",state:"available"},
  {id:"viewport",name:"Viewport control",scope:"browser",description:"Set or reset emulated viewport metrics for session tabs.",state:"available"}
];
const TAB_CAPABILITIES:CapabilityInfo[]=[
  {id:"pageAssets",name:"Page assets",scope:"tab",description:"Inventory and bundle images, fonts, stylesheets, media and inline SVG.",state:"available"},
  {id:"contentExport",name:"Content export",scope:"tab",description:"Export page text, HTML, Markdown, or GSuite-oriented text.",state:"available"},
  {id:"devtools",name:"DevTools",scope:"tab",description:"Restricted CDP calls, event subscriptions and developer logs.",state:"available"},
  {id:"clipboard",name:"Tab clipboard",scope:"tab",description:"Read and write clipboard content with explicit confirmation for writes.",state:"limited"}
];
const DOCS:Record<string,string>={
  userContext:"Use browser.user.openTabs() to inspect open user tabs. Only claim ids returned by openTabs(). Browser history requires a fresh user confirmation.",
  sitePermissions:"The first interaction with a host requires approval. Decisions may be session-only, persistent allow, or block.",
  tabGroups:"Each browser session gets a tab group. finalize({keep}) removes intermediate tabs and keeps only deliverable or handoff tabs.",
  viewport:"Viewport changes apply to claimed session tabs and are resettable.",
  pageAssets:"Call list() to obtain inventory ids, then bundle({inventoryIds,kinds}) to download selected assets through the native host.",
  contentExport:"Export page text/HTML/Markdown. GSuite export uses a specialized visible-content extraction fallback.",
  devtools:"Raw CDP is restricted to an allowlist unless the caller explicitly requests mutating access and policy allows it.",
  clipboard:"Clipboard reads and writes depend on Chrome permissions. Writes require explicit user approval."
};
export class CapabilityRegistry {
  list(scope:"browser"|"tab"){return scope==="browser"?BROWSER_CAPABILITIES:TAB_CAPABILITIES;}
  documentation(id:string){const value=DOCS[id];if(!value)throw new Error(`Unknown capability: ${id}`);return value;}
}
