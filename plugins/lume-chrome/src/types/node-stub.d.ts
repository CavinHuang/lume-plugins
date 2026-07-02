declare const Buffer: any;

declare module "node:http" {
  export function createServer(...args: any[]): any;
}

declare module "node:crypto" {
  export function createHash(...args: any[]): any;
}

declare module "node:fs/promises" {
  export function readFile(path: URL, encoding: "utf8"): Promise<string>;
}
