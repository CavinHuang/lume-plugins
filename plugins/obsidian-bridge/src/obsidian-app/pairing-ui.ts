export function formatPairingCode(code: string): string {
  if (!code) {
    return "—";
  }

  return code.match(/.{1,3}/g)?.join(" ") ?? code;
}
