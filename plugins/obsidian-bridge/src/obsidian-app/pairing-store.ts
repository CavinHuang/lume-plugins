// 配对码/token 存储。注入 now/random 以便纯单测。
export interface PairingStoreDeps {
  ttlMs: number;
  now: () => number;
  random: () => string; // 6 位配对码
}

export interface PairingStore {
  generateCode(): string;
  consumeCode(code: string): string | null; // 成功返回 token,失败 null
  isActive(token: string): boolean;
  reset(): void;
}

export function createPairingStore(deps: PairingStoreDeps): PairingStore {
  let code: { value: string; expiresAt: number } | null = null;
  let token: string | null = null;

  function newToken(): string {
    // 64 字节十六进制
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  return {
    generateCode() {
      code = { value: deps.random(), expiresAt: deps.now() + deps.ttlMs };
      return code.value;
    },
    consumeCode(input) {
      if (!code) return null;
      if (deps.now() > code.expiresAt) {
        code = null;
        return null;
      }
      if (input !== code.value) return null;
      code = null; // 一次性
      token = newToken();
      return token;
    },
    isActive(t) {
      return token !== null && t === token;
    },
    reset() {
      code = null;
      token = null;
    },
  };
}

// 默认实现(生产用)
export function createDefaultPairingStore(ttlMs = 600000): PairingStore {
  return createPairingStore({
    ttlMs,
    now: () => Date.now(),
    random: () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0"),
  });
}
