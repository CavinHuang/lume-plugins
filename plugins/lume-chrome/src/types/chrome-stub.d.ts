// Used only when @types/chrome is not installed in the analysis bundle.
declare const chrome: any;
declare namespace chrome {
  namespace runtime { interface Port { postMessage(message: unknown): void; disconnect(): void; onMessage: any; onDisconnect: any; } }
  namespace tabs { interface Tab { id?: number; title?: string; url?: string; active?: boolean; windowId: number; groupId?: number; favIconUrl?: string; lastAccessed?: number; } }
  namespace scripting { type ExecutionWorld = "ISOLATED" | "MAIN"; }
  namespace downloads { interface DownloadItem { id: number; filename: string; url: string; state: string; } }
  namespace history { interface HistoryItem { url?: string; title?: string; lastVisitTime?: number; } }
}
