import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function readGitCommit(gitDir) {
  const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
  if (/^[a-f0-9]{40}$/i.test(head)) return head.toLowerCase();
  if (!head.startsWith("ref: ")) throw new Error("Git HEAD is neither a commit nor a symbolic ref");
  const ref = head.slice("ref: ".length);
  try {
    const commit = readFileSync(join(gitDir, ...ref.split("/")), "utf8").trim();
    if (/^[a-f0-9]{40}$/i.test(commit)) return commit.toLowerCase();
  } catch { /* packed ref fallback below */ }
  const packed = readFileSync(join(gitDir, "packed-refs"), "utf8");
  const match = packed.split(/\r?\n/).find((line) => line.endsWith(` ${ref}`));
  const commit = match?.split(" ", 1)[0];
  if (!commit || !/^[a-f0-9]{40}$/i.test(commit)) throw new Error(`Cannot resolve Git ref ${ref}`);
  return commit.toLowerCase();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(readGitCommit(process.argv[2]));
}
