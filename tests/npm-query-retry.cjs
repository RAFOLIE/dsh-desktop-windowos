// Local fake registry: exercise real npm retries without touching any installed package.
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const flags = readFileSync('src-tauri/src/npm_operation.rs', 'utf8')
  .split('pub const QUERY_FLAGS')[1].split('];')[0].match(/"--[^"]+"/g).map(s => JSON.parse(s));
const npm = path.join(path.dirname(execFileSync('where.exe', ['npm'], {encoding:'utf8'}).trim().split(/\r?\n/)[0]), 'node_modules/npm/bin/npm-cli.js');
let mode, requests;
const server = http.createServer((req,res) => {
  requests++;
  if(mode === 'reset' || (mode === 'recover' && requests === 1)) return req.socket.destroy();
  res.setHeader('content-type', 'application/json');
  if(mode === 'missing') { res.statusCode = 404; return res.end(JSON.stringify({error:'Not found'})); }
  res.end(JSON.stringify({name:'@deepseek-ai/dsh', 'dist-tags':{latest:'0.1.7-alpha.2'}, versions:{'0.1.7-alpha.2':{name:'@deepseek-ai/dsh',version:'0.1.7-alpha.2'}}}));
});
async function query(scenario) {
  mode = scenario; requests = 0;
  const child = spawn(process.execPath, [npm,'view','@deepseek-ai/dsh@0.1.7-alpha.2','version',
    `--registry=http://127.0.0.1:${server.address().port}`, '--noproxy=127.0.0.1', '--proxy=null', '--https-proxy=null', '--cache=' + require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'dsh-npm-query-test-')), ...flags], {windowsHide:true});
  let out='',err=''; child.stdout.on('data', b => out+=b); child.stderr.on('data', b=>err+=b);
  const timeout = setTimeout(()=>child.kill(),30000);
  const code = await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  clearTimeout(timeout);
  return {code,out,err,requests};
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const recovered = await query('recover');
    assert.equal(recovered.code,0); assert.equal(recovered.out.trim(),'0.1.7-alpha.2'); assert.equal(recovered.requests,2);
    const reset = await query('reset');
    assert.notEqual(reset.code,0); assert.match(reset.err,/ECONNRESET/); assert.equal(reset.requests,3);
    const missing = await query('missing');
    assert.notEqual(missing.code,0); assert.match(missing.err,/E404/); assert.equal(missing.requests,1);
    console.log('PASS: real npm query recovers, retries are bounded, missing version fails without network retry');
  } finally { server.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
