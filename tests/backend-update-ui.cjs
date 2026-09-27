const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const output = process.env.DSH_SCREENSHOT_DIR || require('node:path').join(require('node:os').tmpdir(),'dsh-appearance-check');
fs.mkdirSync(output,{recursive:true});
(async () => {
 const browser = await chromium.launch({channel:'msedge', headless:true});
 const page = await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
 const errors=[]; page.on('pageerror', e => errors.push(e.message));
 await page.addInitScript(() => {
   const callbacks={}, events={}; let n=0;
   const cfg={closeAction:'tray',alwaysOnTop:false,autostart:false,uiTheme:'dark',uiLocale:'zh',uiLocaleResolved:'zh'};
   window.testCalls=[];
   window.testJob={id:'query1',phase:'checking',target:'0.1.7-alpha.2',error:null,elapsedSeconds:24,budgetSeconds:90,installationStarted:false};
   window.testSource={kind:'global',version:'0.1.6-alpha.2',path:'C:/Test/npm/node_modules/@deepseek-ai/dsh',prefix:'C:/Test/npm',pid:123,managed:true};
   window.confirm=message=>{window.lastConfirmation=message;return true;};
   Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(window.clipboardFail)throw new Error('clipboard');window.copiedTheme=text;}}});
   const writeStorage=Storage.prototype.setItem;
   Storage.prototype.setItem=function(k,v){if(window.storageFail&&k==='dsh.appearance.v1')throw new Error('storage');return writeStorage.call(this,k,v);};
   window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
   window.__TAURI_INTERNALS__={
     transformCallback(fn){callbacks[++n]=fn; return n;},
     async invoke(cmd,args={}){
       window.testCalls.push({cmd,args});
       if(cmd==='plugin:event|listen') {events[args.event]=callbacks[args.handler]; return ++n;}
       if(cmd==='app_get_shell_settings') return {...cfg};
       if(cmd==='app_set_ui_theme') {cfg.uiTheme=args.theme; return;}
       if(cmd==='app_set_ui_locale') {cfg.uiLocale=args.locale;cfg.uiLocaleResolved=args.locale;return args.locale;}
       if(cmd==='app_set_always_on_top') {cfg.alwaysOnTop=args.enable;return;}
       if(cmd==='app_set_autostart') {cfg.autostart=args.enable;return;}
       if(cmd==='app_set_close_action') {cfg.closeAction=args.action;return;}
       if(cmd==='env_info') return {app:{version:'1.6.50',installDir:'C:\\DSH'},dsh:{portAnswering:true,webVersion:'0.1.5-rc.1',owner:{pid:14280,owned:true,cmd:'node dsh web',chain:'dsh-desktop → node'},whereDsh:'C:\\Users\\Example\\AppData\\Roaming\\npm\\dsh.cmd'},node:{version:'v24.13.0',path:'C:\\Program Files\\nodejs\\node.exe'},plugins:{dshDesktopPlugin:'1.5.12'},profileDir:'C:\\Users\\Example\\.dsh\\profiles\\web',workspaceDir:'C:\\Users\\Example\\Documents\\ChatGPT\\DSH',logDir:'C:\\Users\\Example\\AppData\\Local\\dsh-desktop\\logs',profileSizeBytes:8430000};
       if(cmd==='dsh_webchat_url') return 'http://127.0.0.1:1420/mock-chat';
       if(cmd==='app_get_update_config') return {channel:'stable',autoUpdate:true};
       if(cmd==='dsh_npm_channels') return {latest:'0.1.7-alpha.2'};
       if(cmd==='dsh_backend_source') return {...window.testSource};
       if(cmd==='dsh_backend_update_status') return window.testJob;
       if(cmd==='dsh_backend_upgrade') {
         window.testJob={id:'retry1',phase:'checking',target:args.target,error:null,elapsedSeconds:0,budgetSeconds:90,installationStarted:false};
         return window.testJob;
       }
       if(cmd==='app_latest_stable') return {latest:'1.6.50'};
       if(cmd==='log_tail') return ['[2026-09-14 15:30:01] [INFO] DSH ready at http://127.0.0.1:3080','[2026-09-14 15:30:02] [INFO] Desktop connected'];
       return null;
     }
   };
   window.testEmit=(name,payload)=>events[name]?.({payload});
   window.testReady=()=>{events['dsh-status']?.({payload:{status:'ready',attached:false}});events['app-update']?.({payload:{state:'none'}});};
 });
 await page.route('**/mock-chat',r=>r.fulfill({contentType:'text/html',body:'<textarea id="draft">Persistent draft</textarea>'}));
 await page.goto('http://127.0.0.1:1420/');
 await page.waitForFunction(()=>window.testCalls.some(c=>c.cmd==='plugin:event|listen' && c.args.event==='webchat-auth-hint'));
 await page.evaluate(()=>window.testEmit('app-update',{state:'none'}));

 await page.locator('.tb-pill').click();
 await page.getByRole('button',{name:'更新',exact:true}).click();
 await page.getByText('已等待 24 秒',{exact:false}).waitFor();
 await page.getByRole('note').filter({hasText:'settingsScope'}).waitFor();
 assert.ok(await page.getByRole('button',{name:'更新至 0.1.7-alpha.2',exact:true}).isDisabled());
 await page.screenshot({path:output+'/dsh-update-checking.png'});
 await page.getByRole('button',{name:'常规',exact:true}).click();
 await page.getByRole('button',{name:'更新',exact:true}).click();
 await page.getByText('已等待 24 秒',{exact:false}).waitFor();
 await page.evaluate(()=>{window.testJob={...window.testJob,phase:'failed',failedPhase:'checking',error:'npm: TIMEOUT; exit=none; codes=[ECONNRESET]'};});
 await page.getByText('尚未开始安装，本次操作未改变已安装版本。',{exact:true}).waitFor();
 await page.getByText('连接 npm 官方仓库时被重置',{exact:false}).waitFor();
 await page.locator('.bu-job[role=status]').scrollIntoViewIfNeeded();
 await page.screenshot({path:output+'/dsh-update-failed.png'});
 await page.locator('.bu-job[role=status]').getByRole('button',{name:'查看日志',exact:true}).click();
 await page.getByText('DSH ready at',{exact:false}).waitFor();
 await page.getByRole('button',{name:'更新',exact:true}).click();
 const retry=page.getByRole('button',{name:'重试更新',exact:true});
 await retry.waitFor(); await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='重试更新')?.disabled);
 await page.evaluate(()=>window.testSource.pid=456);
 await retry.click();
 await page.getByText('正在确认目标版本 · 0.1.7-alpha.2',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='dsh_backend_upgrade').length),1);
 assert.match(await page.evaluate(()=>window.lastConfirmation),/settingsScope/);
 await page.evaluate(()=>window.testJob={...window.testJob,id:'installFailure',phase:'failed',failedPhase:'installing',installationStarted:true,error:'npm: FAILED; exit=1; codes=[EPERM]'});
 await page.getByText('失败阶段: 正在安装',{exact:true}).waitFor();
 assert.equal(await page.getByText('尚未开始安装，本次操作未改变已安装版本。',{exact:true}).count(),0);
 await page.getByText('本次已尝试安装，请核对安装及运行版本后再重试。',{exact:true}).waitFor();
 await page.evaluate(()=>window.testJob={...window.testJob,id:'notFound',failedPhase:'checking',installationStarted:false,error:'npm: FAILED; exit=1; codes=[E404]'});
 await page.getByText('npm 官方仓库中没有查询到目标版本',{exact:false}).waitFor();
 await page.getByRole('button',{name:'常规',exact:true}).click();
 await page.locator('.ep-select').first().click();
 await page.getByRole('option',{name:'English',exact:true}).click();
 await page.getByRole('button',{name:'Appearance',exact:true}).click();
 await page.getByRole('radio',{name:'Light',exact:true}).click();
 await page.getByRole('button',{name:'Update',exact:true}).click();
 await page.getByText('The selected version is not available',{exact:false}).waitFor();
 await page.locator('.bu-job[role=status]').scrollIntoViewIfNeeded();
 await page.screenshot({path:output+'/dsh-update-light-en.png'});
 await page.evaluate(()=>window.testSource.version='0.1.7-alpha.2');
 await page.getByRole('button',{name:'Check again',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.bu-section')?.textContent.includes('Already on this channel version'));
 assert.equal(await page.getByRole('note').count(),0);
 await page.evaluate(()=>{window.testSource.version='0.1.5-rc.2';window.testSource.kind='external';window.testJob=null;});
 await page.getByRole('button',{name:'Check again',exact:true}).click();
 const update=page.getByRole('button',{name:'Update to 0.1.7-alpha.2',exact:true});
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Update to 0.1.7-alpha.2'&&!b.disabled));
 await page.getByRole('note').filter({hasText:'started externally'}).waitFor();
 const callsBefore=await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='dsh_backend_upgrade').length);
 await page.evaluate(()=>window.confirm=message=>{window.lastConfirmation=message;return false;});
 await update.click();
 assert.match(await page.evaluate(()=>window.lastConfirmation),/stops this process and its children/);
 assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='dsh_backend_upgrade').length),callsBefore);
 await page.screenshot({path:output+'/dsh-update-external-en.png'});
 await page.evaluate(()=>window.confirm=()=>true);
 await update.click();
 await page.waitForFunction(()=>window.testCalls.filter(c=>c.cmd==='dsh_backend_upgrade').at(-1)?.args.allowExternal===true);
 const accepted=await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='dsh_backend_upgrade').at(-1).args);
 assert.equal(accepted.expectedPid,456);
 assert.equal(accepted.expectedVersion,'0.1.5-rc.2');
 await page.evaluate(()=>{window.testJob=null;window.testSource.managed=false;window.testSource.kind='custom';});
 await page.getByRole('button',{name:'General',exact:true}).click();
 await page.getByRole('button',{name:'Update',exact:true}).click();
 await page.getByText('One-click updates are unavailable for this source.',{exact:false}).waitFor();
 assert.ok(await page.getByRole('button',{name:'Update to 0.1.7-alpha.2',exact:true}).isDisabled());
 assert.deepEqual(errors,[]);
 await browser.close(); console.log('PASS: update progress, failure diagnostics, remount, logs and guarded retry');
})().catch(e=>{console.error(e);process.exit(1);});
