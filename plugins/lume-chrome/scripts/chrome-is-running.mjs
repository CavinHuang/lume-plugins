import child_process from "node:child_process";
const cmd = process.platform === "win32" ? "tasklist" : "ps ax";
const out = child_process.execSync(cmd, { encoding:"utf8" });
console.log(/chrome|Google Chrome/i.test(out) ? "Chrome appears to be running" : "Chrome not detected");
