// Opt-in Windows GUI regression. Opens and closes ONLY fresh fixture folders.
// Set DSH_NATIVE_COMMAND_MODULE to the official dsh-native-command/lib/index.js.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const modulePath=process.env.DSH_NATIVE_COMMAND_MODULE;
assert.ok(modulePath && fs.existsSync(modulePath),'DSH_NATIVE_COMMAND_MODULE is required');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-explorer-visibility-'));
const shim=path.resolve(__dirname,'../src-tauri/src/explorer-visibility.cjs').replaceAll('\\','/');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function inspect(folder,close=false) {
 const url=pathToFileURL(folder).href;
 const script=`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DshVisibility { [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); }'; $s=New-Object -ComObject Shell.Application; @($s.Windows()) | Where-Object {[Uri]::UnescapeDataString($_.LocationURL) -eq [Uri]::UnescapeDataString('${url.replaceAll("'","''")}')} | ForEach-Object { ${close?'$_.Quit()':'[DshVisibility]::IsWindowVisible([IntPtr]$_.HWND)'} }`;
 const p=spawnSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:15000});
 assert.equal(p.status,0,p.stderr);return p.stdout.trim();
}
(async()=>{
 const results=[];
 try {
  for(const patched of [false,true]) for(const action of ['openNativePath','revealNativePath']) {
   const folder=path.join(root,`${patched?'patched':'baseline'}-${action}-中文,等=号`);
   fs.mkdirSync(folder);const file=path.join(folder,'test.txt');fs.writeFileSync(file,'fixture');
   const target=action==='openNativePath'?folder:file;
   const code=`const m=await import(${JSON.stringify(pathToFileURL(modulePath).href)});await m[${JSON.stringify(action)}](${JSON.stringify(target)},new AbortController().signal);`;
   const env={...process.env,NODE_OPTIONS:patched?`--require="${shim}"`:''};
   const child=spawnSync(process.execPath,['--input-type=module','-e',code],{windowsHide:true,env,encoding:'utf8',timeout:15000});
   assert.equal(child.status,0,child.stderr);
   let visible='';for(let i=0;i<10&&!visible;i++){await wait(300);visible=inspect(folder);}
   assert.equal(visible,patched?'True':'False',`${action}: actual Windows visibility`);
   results.push({patched,action,visible});console.log(JSON.stringify(results.at(-1)));
   inspect(folder,true);
  }
  fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(results,null,2));
  console.log('PASS: actual Windows visibility for open and reveal, including Unicode and separators');
 } finally { for(const f of fs.readdirSync(root)) {const full=path.join(root,f);if(fs.statSync(full).isDirectory())inspect(full,true);} }
})().catch(e=>{console.error(e);process.exitCode=1;});
