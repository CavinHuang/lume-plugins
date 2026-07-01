import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const candidates = [
  path.join(os.homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.lume.browser.json"),
  path.join(os.homedir(), ".config/google-chrome/NativeMessagingHosts/com.lume.browser.json"),
  path.join(os.homedir(), "AppData/Local/Lume/ChromeNativeMessaging/com.lume.browser.json")
];
for (const c of candidates) if (fs.existsSync(c)) { console.log(JSON.parse(fs.readFileSync(c, "utf8"))); process.exit(0); }
console.error("Native host manifest not found"); process.exit(1);
