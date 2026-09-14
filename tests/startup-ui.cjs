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
       if(cmd==='dsh_npm_channels') return {latest:'0.1.5-rc.1',next:'0.1.6-alpha.1'};
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
 for (const [method,elapsed,budget] of [['dsh web',60,120],['npx 下载并启动',180,300]]) {
   await page.evaluate(({method,elapsed,budget})=>window.testEmit('dsh-status',{status:'starting',method,phase:'waiting',elapsed,budget}),{method,elapsed,budget});
   await page.getByRole('status').filter({hasText:`已等待 ${elapsed} 秒`}).waitFor();
   assert.ok((await page.locator('.boot-wrap').innerText()).includes(`最多等待 ${budget} 秒`));
   assert.equal(await page.locator('iframe').count(),0);
 }
 await page.screenshot({path:output+'/dsh-startup-dark.png'});
 await page.locator('.tb-pill').click();
 await page.getByRole('button',{name:'常规',exact:true}).click();
 await page.locator('.ep-select').first().click();
 await page.getByRole('option',{name:'English',exact:true}).click();
 await page.keyboard.press('Escape');
 await page.getByRole('status').filter({hasText:'Waiting 180s'}).waitFor();
 await page.screenshot({path:output+'/dsh-startup-en.png'});
 await page.locator('.tb-pill').click();
 await page.locator('.ep-tab').nth(1).click();
 await page.getByRole('radio',{name:'Light',exact:true}).click();
 await page.keyboard.press('Escape');
 await page.waitForTimeout(100);
 await page.setViewportSize({width:560,height:760});
 assert.ok(await page.locator('.boot-wrap').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
 await page.screenshot({path:output+'/dsh-startup-light-narrow.png'});

 await page.evaluate(()=>window.testEmit('dsh-status',{status:'error',message:'Profile writer lock timeout: example/node_modules.lock. Lock preserved.'}));
 await page.getByText('Profile writer lock timeout:',{exact:false}).waitFor();
 await page.evaluate(()=>window.testReady());
 await page.locator('iframe').waitFor();
 for(const state of ['pending','checking','downloading','done','failed','none']) {
   await page.evaluate(state=>window.testEmit('app-update',{state}),state);
   assert.equal(await page.locator('.boot-wrap').count(),0,'update state blocked chat: '+state);
   assert.equal(await page.locator('iframe').isVisible(),true);
 }
 await page.evaluate(()=>window.testEmit('dsh-status',{status:'starting',method:'restart'}));
 await page.locator('.boot-wrap').waitFor();
 await page.evaluate(()=>{window.testEmit('app-update',{state:'checking'});window.testEmit('dsh-status',{status:'ready',attached:false});});
 await page.waitForFunction(()=>!document.querySelector('.boot-wrap'));
 assert.equal(await page.locator('iframe').isVisible(),true);

 assert.deepEqual(errors,[]);
 console.log('PASS: slow installed/npx progress, English localization, lock error, ready transition');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
