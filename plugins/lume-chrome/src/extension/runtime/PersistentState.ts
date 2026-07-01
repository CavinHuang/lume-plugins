export class PersistentState<T> {
  constructor(private readonly area: "local" | "session", private readonly key: string, private readonly fallback: T) {}
  private storage() { return this.area === "session" ? chrome.storage.session : chrome.storage.local; }
  async load(): Promise<T> {
    const result = await this.storage().get(this.key);
    return { ...this.fallback, ...(result[this.key] ?? {}) } as T;
  }
  async save(value: T): Promise<void> { await this.storage().set({ [this.key]: value }); }
  async clear(): Promise<void> { await this.storage().remove(this.key); }
}
