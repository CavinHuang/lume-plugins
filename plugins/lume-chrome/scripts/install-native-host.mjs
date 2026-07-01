import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const extensionId=process.env.LUME_EXTENSION_ID;
if(!extensionId)throw new Error("Set LUME_EXTENSION_ID to the installed Chrome extension id");
const executableName=process.platform==="win32"?"lume-chrome-host.exe":"lume-chrome-host";
const hostPath=path.resolve(process.env.LUME_CHROME_HOST_PATH??`native-host/target/release/${executableName}`);
if(!fs.existsSync(hostPath))throw new Error(`Native host executable not found: ${hostPath}`);
const base=process.platform==="win32"?path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),"AppData/Local"),"Lume/ChromeNativeMessaging"):
  process.platform==="darwin"?path.join(os.homedir(),"Library/Application Support/Google/Chrome/NativeMessagingHosts"):
  path.join(os.homedir(),".config/google-chrome/NativeMessagingHosts");
fs.mkdirSync(base,{recursive:true});
const manifestPath=path.join(base,"com.lume.browser.json");
const manifest={name:"com.lume.browser",description:"Lume Chrome native messaging host",path:hostPath,type:"stdio",allowed_origins:[`chrome-extension://${extensionId}/`]};
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
const configPath=path.join(path.dirname(hostPath),"extension-host-config.json");
const config={schemaVersion:1,channel:process.env.LUME_CHANNEL??"dev",extensionId,appServerUrl:process.env.LUME_APP_SERVER_URL??"ws://127.0.0.1:43127/browser",appServerCommand:process.env.LUME_APP_SERVER_COMMAND||undefined,appServerArgs:[],assetRoot:process.env.LUME_BROWSER_ASSET_ROOT||undefined};
fs.writeFileSync(configPath,JSON.stringify(config,null,2));
if(process.platform==="win32")execFileSync("reg",["add","HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.lume.browser","/ve","/t","REG_SZ","/d",manifestPath,"/f"],{stdio:"inherit"});
console.log(JSON.stringify({manifestPath,configPath,hostPath},null,2));
