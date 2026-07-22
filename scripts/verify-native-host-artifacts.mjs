import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const artifacts = [
  { target: "win32-x64", file: "lume-chrome-host.exe", format: "pe", machine: 0x8664 },
  { target: "darwin-x64", file: "lume-chrome-host", format: "macho", machine: 0x01000007 },
  { target: "darwin-arm64", file: "lume-chrome-host", format: "macho", machine: 0x0100000c },
  { target: "linux-x64", file: "lume-chrome-host", format: "elf", machine: 0x3e },
];

for (const artifact of artifacts) {
  const path = resolve("plugins", "lume-chrome", "runtime", artifact.target, artifact.file);
  const info = statSync(path);
  if (!info.isFile() || info.size < 64 * 1024) throw new Error(`${artifact.target} runtime is missing or unexpectedly small`);
  const bytes = readFileSync(path);
  const machine = artifact.format === "pe"
    ? readPeMachine(bytes)
    : artifact.format === "macho"
      ? readMachOMachine(bytes)
      : readElfMachine(bytes);
  if (machine !== artifact.machine) {
    throw new Error(`${artifact.target} machine mismatch: expected 0x${artifact.machine.toString(16)}, got 0x${machine.toString(16)}`);
  }
  console.log(`✓ ${artifact.target} ${artifact.format} ${info.size} bytes`);
}

function readPeMachine(bytes) {
  if (bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("invalid PE DOS signature");
  const header = bytes.readUInt32LE(0x3c);
  if (bytes.toString("ascii", header, header + 4) !== "PE\0\0") throw new Error("invalid PE signature");
  return bytes.readUInt16LE(header + 4);
}

function readMachOMachine(bytes) {
  if (bytes.readUInt32LE(0) !== 0xfeedfacf) throw new Error("invalid 64-bit Mach-O signature");
  return bytes.readUInt32LE(4);
}

function readElfMachine(bytes) {
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error("invalid ELF signature");
  if (bytes[4] !== 2 || bytes[5] !== 1) throw new Error("ELF runtime must be 64-bit little-endian");
  return bytes.readUInt16LE(18);
}
