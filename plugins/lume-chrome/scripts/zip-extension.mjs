import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root=process.cwd();const stage=path.join(root,".build","extension");const out=path.join(root,"lume-browser-extension-v4.zip");
fs.rmSync(path.dirname(stage),{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true});
for(const entry of fs.readdirSync(path.join(root,"extension")))fs.cpSync(path.join(root,"extension",entry),path.join(stage,entry),{recursive:true});
fs.cpSync(path.join(root,"dist"),path.join(stage,"dist"),{recursive:true});
fs.rmSync(out,{force:true});
if(process.platform==="win32"){
  execFileSync("powershell",[
    "-NoProfile",
    "-ExecutionPolicy","Bypass",
    "-Command",
    "& { param($stagePath,$outPath) $ErrorActionPreference='Stop'; Compress-Archive -Path (Join-Path $stagePath '*') -DestinationPath $outPath -Force }",
    stage,
    out
  ],{stdio:"inherit"});
}else{
  execFileSync("zip",["-qr",out,"."],{cwd:stage});
}
console.log(out);
