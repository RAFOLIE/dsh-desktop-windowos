const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {promisify}=require('node:util');
const source = fs.readFileSync(path.join(__dirname,'../src-tauri/src/explorer-visibility.cjs'),'utf8');
function fixture(platform='win32') {
  const calls=[]; const result={pid:123}; let synced=false;
  const cp={execFile(...args){calls.push(args);return result;}};
  cp.execFile[promisify.custom]=(...args)=>{calls.push(args);return result;};
  vm.runInNewContext(source,{require(name){return name==='node:child_process'?cp:name==='node:module'?{syncBuiltinESMExports(){synced=true;}}:name==='node:util'?{promisify}:path;},process:{platform,env:{SystemRoot:'C:\\Windows'}}});
  assert.equal(synced,true);return {cp,calls,result};
}
test('Explorer shows while arguments, callbacks, abort signal and return value survive',()=>{
 const {cp,calls,result}=fixture(); const signal=new AbortController().signal;const cb=()=>{};
 const options={windowsHide:true,encoding:'utf8',signal};const args=['/select,file:///C:/中文%2Cfolder/file.txt'];
 assert.equal(cp.execFile('C:\\Windows\\explorer.exe',args,options,cb),result);
 assert.equal(calls[0][1],args);assert.equal(calls[0][3],cb);assert.equal(calls[0][2].signal,signal);
 assert.equal(calls[0][2].windowsHide,false);assert.equal(options.windowsHide,true);
});
test('all unrelated commands and explicit visible launches stay unchanged',()=>{
 for(const command of ['powershell.exe','cmd.exe','node.exe','C:\\Other\\explorer.exe']) {
  const {cp,calls}=fixture();const options={windowsHide:true};cp.execFile(command,[],options);assert.equal(calls[0][2],options);
 }
 const {cp,calls}=fixture();const options={windowsHide:false};cp.execFile('explorer.exe',options,()=>{});assert.equal(calls[0][1],options);
});
test('no-argv overload and Linux stay compatible',()=>{
 const {cp,calls}=fixture();cp.execFile('EXPLORER.EXE',{windowsHide:true},()=>{});assert.equal(calls[0][1].windowsHide,false);
 const other=fixture('linux');const options={windowsHide:true};other.cp.execFile('explorer.exe',[],options);assert.equal(other.calls[0][2],options);
});

test('promisified calls preserve the native result and change only Explorer visibility',()=>{
 const {cp,calls,result}=fixture();
 assert.equal(promisify(cp.execFile)('explorer.exe',[],{windowsHide:true}),result);
 assert.equal(calls[0][2].windowsHide,false);
 const options={windowsHide:true};
 assert.equal(promisify(cp.execFile)('node.exe',[],options),result);
 assert.equal(calls[1][2],options);
});
