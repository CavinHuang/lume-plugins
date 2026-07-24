import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const extensionId=process.env.LUME_EXTENSION_ID;
if(!extensionId)throw new Error("Set LUME_EXTENSION_ID to the installed Chrome extension id");
if(!/^[a-p]{32}$/.test(extensionId))throw new Error("LUME_EXTENSION_ID is not a valid Chrome extension id");
const pairingKey=process.env.LUME_BROWSER_PAIRING_KEY??randomBytes(32).toString("base64url");
const pairingId=process.env.LUME_BROWSER_PAIRING_ID??randomUUID();
const generation=Number(process.env.LUME_BROWSER_PAIRING_GENERATION??Date.now());
if(!/^[A-Za-z0-9_-]{43}$/.test(pairingKey)||Buffer.from(pairingKey,"base64url").length!==32)throw new Error("LUME_BROWSER_PAIRING_KEY must encode exactly 32 bytes");
if(!/^[A-Za-z0-9_-]{8,96}$/.test(pairingId))throw new Error("LUME_BROWSER_PAIRING_ID is invalid");
if(!Number.isSafeInteger(generation)||generation<=0)throw new Error("LUME_BROWSER_PAIRING_GENERATION must be a positive safe integer");
const executableName=process.platform==="win32"?"lume-chrome-host.exe":"lume-chrome-host";
const hostPath=path.resolve(process.env.LUME_CHROME_HOST_PATH??`native-host/target/release/${executableName}`);
if(!fs.existsSync(hostPath))throw new Error(`Native host executable not found: ${hostPath}`);
const hostSha256=createHash("sha256").update(fs.readFileSync(hostPath)).digest("hex");
const base=process.platform==="win32"?path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),"AppData/Local"),"Lume/ChromeNativeMessaging"):
  process.platform==="darwin"?path.join(os.homedir(),"Library/Application Support/Google/Chrome/NativeMessagingHosts"):
  path.join(os.homedir(),".config/google-chrome/NativeMessagingHosts");
fs.mkdirSync(base,{recursive:true});
const manifestPath=path.join(base,"com.lume.browser.json");
const manifest={name:"com.lume.browser",description:"Lume Chrome native messaging host",path:hostPath,type:"stdio",allowed_origins:[`chrome-extension://${extensionId}/`]};
const configPath=path.join(path.dirname(hostPath),"extension-host-config.json");
const bridgeRoot=process.platform==="win32"?path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),"AppData/Local"),"Lume/ChromeNativeMessaging"):
  process.platform==="darwin"?path.join(os.homedir(),"Library/Application Support/Lume/ChromeNativeMessaging"):
  path.join(os.homedir(),".config/Lume/ChromeNativeMessaging");
fs.mkdirSync(bridgeRoot,{recursive:true});
const endpoint=process.env.LUME_BROWSER_PIPE_ENDPOINT??(process.platform==="win32"?`\\\\.\\pipe\\lume-browser-${createHash("sha256").update(os.homedir()).digest("hex").slice(0,24)}`:path.join(bridgeRoot,"browser.sock"));
if(process.platform==="win32"?!/^\\\\\.\\pipe\\lume-browser-[A-Za-z0-9_-]{8,80}$/.test(endpoint):!endpoint.endsWith(".sock"))throw new Error("LUME_BROWSER_PIPE_ENDPOINT is invalid");
const bridgeConfigPath=path.join(bridgeRoot,"bridge-config.json");
let previousPairingId;
try{const previous=JSON.parse(fs.readFileSync(bridgeConfigPath,"utf8"));if(typeof previous.pairingId==="string")previousPairingId=previous.pairingId;}catch{}
const pairingStore=spawnSync(hostPath,["pairing","store",pairingId],{input:pairingKey,encoding:"utf8",windowsHide:true});
if(pairingStore.status!==0)throw new Error(`Failed to store browser pairing key in the OS credential store: ${pairingStore.stderr||"unknown error"}`);
const config={schemaVersion:3,channel:process.env.LUME_CHANNEL??"dev",extensionId,pipeEndpoint:endpoint,pairingId,generation,hostSha256,assetRoot:process.env.LUME_BROWSER_ASSET_ROOT||undefined};
try{
  writeJsonAtomic(manifestPath,manifest);
  writeJsonAtomic(configPath,config);
  writeJsonAtomic(bridgeConfigPath,{schemaVersion:3,endpoint,pairingId,generation,hostPath,hostSha256});
}catch(error){
  spawnSync(hostPath,["pairing","delete",pairingId],{encoding:"utf8",windowsHide:true});
  throw error;
}
if(previousPairingId&&previousPairingId!==pairingId){
  const cleanup=spawnSync(hostPath,["pairing","delete",previousPairingId],{encoding:"utf8",windowsHide:true});
  if(cleanup.status!==0)console.warn("Previous browser pairing credential could not be deleted; its generation is revoked.");
}
if(process.platform==="win32"){
  execFileSync("reg",["add","HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.lume.browser","/ve","/t","REG_SZ","/d",manifestPath,"/f"],{stdio:"inherit"});
  const account=process.env.USERNAME;
  if(account)for(const protectedPath of [configPath,bridgeConfigPath])execFileSync("icacls",[protectedPath,"/inheritance:r","/grant:r",`${account}:(R,W)`],{stdio:"ignore"});
}
console.log(JSON.stringify({manifestPath,configPath,bridgeConfigPath,hostPath},null,2));

function writeJsonAtomic(target,value){
  const temporary=`${target}.${process.pid}.${randomUUID()}.tmp`;
  try{
    fs.writeFileSync(temporary,JSON.stringify(value,null,2),{mode:0o600,flag:"wx"});
    fs.renameSync(temporary,target);
  }finally{
    fs.rmSync(temporary,{force:true});
  }
}
