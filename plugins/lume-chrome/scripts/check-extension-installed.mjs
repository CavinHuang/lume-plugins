import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const id = process.env.LUME_EXTENSION_ID;
if (!id) { console.error("Set LUME_EXTENSION_ID"); process.exit(2); }
const roots = [
  path.join(os.homedir(), "AppData/Local/Google/Chrome/User Data"),
  path.join(os.homedir(), "Library/Application Support/Google/Chrome"),
  path.join(os.homedir(), ".config/google-chrome")
];
for (const root of roots) if (fs.existsSync(root)) {
  const profiles = fs.readdirSync(root).filter(x => x === "Default" || x.startsWith("Profile"));
  for (const p of profiles) {
    const ext = path.join(root, p, "Extensions", id);
    if (fs.existsSync(ext)) console.log(JSON.stringify({ profile:p, path:ext }, null, 2));
  }
}
