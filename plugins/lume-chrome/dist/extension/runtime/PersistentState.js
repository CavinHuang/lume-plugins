export class PersistentState {
    area;
    key;
    fallback;
    constructor(area, key, fallback) {
        this.area = area;
        this.key = key;
        this.fallback = fallback;
    }
    storage() { return this.area === "session" ? chrome.storage.session : chrome.storage.local; }
    async load() {
        const result = await this.storage().get(this.key);
        return { ...this.fallback, ...(result[this.key] ?? {}) };
    }
    async save(value) { await this.storage().set({ [this.key]: value }); }
    async clear() { await this.storage().remove(this.key); }
}
