// Opt-in, real-backend matrix. Every run uses a new DSH_HOME and random port.
// DSH_COMPAT_INSTALLS: JSON map of exact version -> installed CLI package root.
// DSH_COMPAT_TEST_BIN: compiled Rust --lib test executable (custom-protocol).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const versions = ['0.1.6-alpha.2', '0.1.7-alpha.2'];
const installs = JSON.parse(process.env.DSH_COMPAT_INSTALLS || '{}');
const testBin = process.env.DSH_COMPAT_TEST_BIN;
const wait = ms => new Promise(r=>setTimeout(r,ms));
const results = [];
async function verify(version) {
  const cli = path.resolve(installs[version] || 'missing');
  assert.equal(JSON.parse(fs.readFileSync(path.join(cli,'package.json'),'utf8')).version, version);
  assert.ok(testBin && fs.existsSync(testBin), 'Rust test binary required');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-compat-${version}-`));
  const profile = path.join(home,'profiles/web');
  fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(profile,'package.json'),JSON.stringify({name:'dsh-compat-fixture',private:true,dependencies:{},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}));
  // Exercise the production shim capability resolver against the real package.
  const shim = path.join(home,'dsh.cmd');
  const relative = path.relative(home,path.join(cli,'lib/bin.js')).replaceAll('\\','/');
  fs.writeFileSync(shim,`@node "%dp0%/${relative}" %*\r\n`);
  let child, browser, outer, output='', launch, stage='startup';
  try {
    child = spawn(process.execPath,[path.join(cli,'lib/bin.js'),'web','--host','127.0.0.1','--port','0','--no-open'],{cwd:home,env:{...process.env,DSH_HOME:home,NODE_OPTIONS:(process.env.NODE_OPTIONS || '')+' --require="'+path.resolve(__dirname,'../src-tauri/src/explorer-visibility.cjs').replaceAll('\\','/')+'"'},windowsHide:true});
    child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    const started = Date.now();
    while(Date.now()-started<120000) {
      launch = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/)?.[0];
      if(launch) break;
      if(child.exitCode!==null) throw new Error(`backend exited ${child.exitCode}`);
      await wait(250);
    }
    assert.ok(launch,'No authenticated launch URL within installed-candidate budget');
    const base = new URL(launch).origin;
    const rust = spawnSync(testBin,['--ignored','exact_backend_auth_contract','--test-threads=1'],{env:{...process.env,DSH_COMPAT_BASE:base,DSH_COMPAT_LAUNCH:launch,DSH_COMPAT_SHIM:shim},encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(rust.status,0, 'Production Rust readiness/auth/capability verification failed: '+rust.stdout);
    assert.match(rust.stdout,/1 passed/,'Native test must actually execute');
    browser = await chromium.launch({channel:'msedge',headless:true});
    const context = await browser.newContext({viewport:{width:1440,height:960}});
    const page = await context.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    stage='browser';
    await page.goto(launch,{waitUntil:'domcontentloaded'});
    await page.getByText('探索未至之境',{exact:true}).waitFor({timeout:45000});
    await page.getByText('继续',{exact:true}).waitFor({timeout:15000});
    await page.getByText('继续',{exact:true}).click();
    await page.getByText('继续',{exact:true}).waitFor({state:'hidden',timeout:10000});
    await page.getByText('稍后配置',{exact:true}).waitFor({timeout:3000}).catch(()=>{});
    if(await page.getByText('稍后配置',{exact:true}).isVisible()) await page.getByText('稍后配置',{exact:true}).click();
    if(await page.getByText('选择工作区',{exact:true}).isVisible()) {
      const response = await context.request.post(base+'/api/workspace/create', {
        headers:{Origin:base}, data:{type:'client-request',rpcId:require('node:crypto').randomUUID(),method:'workspace/create',payload:{args:{request:{path:home}}}}
      });
      const created=await response.json();
      assert.equal(created.result?.ok,true,'Create isolated workspace: '+JSON.stringify(created));
      await page.getByText('选择工作区',{exact:true}).click();
      await page.getByText(created.result.value.workspace.title,{exact:true}).last().click();
    }
    await page.locator('[contenteditable="true"],textarea').first().waitFor({timeout:45000});
    assert.doesNotMatch(await page.locator('body').innerText(),/Failed to load plugins|authentication required/);
    const cookies = (await context.cookies(base)).filter(c=>c.name.startsWith('dsh-auth-'));
    assert.equal(cookies.length,1,'Expected signed browser cookie');
    // Same attributes used by the desktop WebView2 cookie injection.
    await context.addCookies(cookies.map(c=>({...c,sameSite:'None',secure:true})));
    outer=require('node:http').createServer((req,res)=>{
      res.setHeader('Content-Type','text/html');
      res.end('<iframe title="DSH" src="'+base+'/" style="width:100%;height:900px"></iframe>');
    });
    await new Promise(resolve=>outer.listen(0,'127.0.0.1',resolve));
    stage='iframe';
    await page.goto('http://localhost:'+outer.address().port);
    const frame = page.frameLocator('iframe');
    await frame.locator('[contenteditable="true"],textarea').first().waitFor({timeout:45000});
    assert.doesNotMatch(await frame.locator('body').innerText(),/Failed to load plugins|authentication required/);
    await frame.getByText('稍后配置',{exact:true}).waitFor({timeout:5000}).catch(()=>{});
    if(await frame.getByText('稍后配置',{exact:true}).isVisible()) await frame.getByText('稍后配置',{exact:true}).click();
    const editor=frame.locator('[contenteditable="true"],textarea').first();
    await editor.click();
    await editor.pressSequentially('Compatibility draft - not sent',{delay:20});
    assert.match(await editor.evaluate(el=>el.value ?? el.textContent),/Compatibility draft/);
    await editor.fill('');
    stage='reload';
    await page.reload();
    await page.frameLocator('iframe').locator('[contenteditable="true"],textarea').first().waitFor({timeout:45000});
    await page.frameLocator('iframe').getByText('稍后配置',{exact:true}).waitFor({timeout:3000}).catch(()=>{});
    if(await page.frameLocator('iframe').getByText('稍后配置',{exact:true}).isVisible()) await page.frameLocator('iframe').getByText('稍后配置',{exact:true}).click();
    assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(home,'desktop-frame.png')});
    results.push({version,passed:true,checks:['native readiness','CLI capability','303 + signed cookie','browser UI','cross-site iframe','draft input','reload'],home});
    console.log(`PASS ${version}: native contract + browser + desktop-style iframe + reload`);
  } catch(error) {
    if(browser) {
      const failedPage=browser.contexts()[0]?.pages()[0];
      if(failedPage) {
        await failedPage.screenshot({path:path.join(home,'failure.png')});
        const diagnostic=await failedPage.locator('body').innerText().catch(()=> '');
        console.log('Failure stage: '+stage+'; '+diagnostic.slice(0,2000));
      }
    }
    console.log('Fixture: '+home);
    const clean = String(error.message).replace(/http:\/\/[^\s"']+\?token=[^\s"']+/g,'[launch URL redacted]');
    throw new Error(`${version}: ${clean}`);
  } finally {
    if(browser) await browser.close();
    if(outer) await new Promise(resolve=>outer.close(resolve));
    if(child && child.exitCode===null) spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  }
}
(async()=>{
  for(const version of versions) await verify(version);
  const report=path.join(os.tmpdir(),'dsh-backend-compatibility-results.json');
  fs.writeFileSync(report,JSON.stringify(results,null,2));
  console.log('Report: '+report);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
