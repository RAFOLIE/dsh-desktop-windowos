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
       if(cmd==='app_get_shell_settings') return {...cfg,trayClickAction:localStorage.getItem('testTrayClick') || 'double'};
       if(cmd==='app_set_tray_click_action') {if(window.failTraySave)throw new Error('save failed');localStorage.setItem('testTrayClick',args.action);return;}
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


 for (const theme of ['light','dark']) {
   await page.evaluate(async theme=>(await import('/src/theme.ts')).applySkin(theme),theme);
   for (const command of ['window_minimize','window_toggle_maximize','window_close']) {
     const button=page.locator('.tb-btn').nth(['window_minimize','window_toggle_maximize','window_close'].indexOf(command));
     await button.hover();
     assert.equal(await button.evaluate(el=>el.classList.contains('is-hovered')),true);
     await button.click();
     // Pointer stays over the control: CSS :hover remains true, reproducing
     // the stale browser state without minimizing the test browser itself.
     assert.equal(await button.evaluate(el=>el.matches(':hover')),true);
     assert.equal(await button.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
     assert.equal(await page.evaluate(command=>window.testCalls.some(c=>c.cmd===command),command),true);
     const box=await button.boundingBox();
     await page.mouse.move(box.x+5,box.y+5);
     assert.equal(await button.evaluate(el=>el.classList.contains('is-hovered')),true);
     await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
     await page.waitForFunction(()=>![...document.querySelectorAll('.tb-btn')].some(el=>el.classList.contains('is-hovered')));
     assert.equal(await button.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
   }
   await page.screenshot({path:require('node:path').join(output,`titlebar-hover-${theme}.png`)});
 }
 assert.deepEqual(errors,[]);
 await browser.close();
 console.log('PASS titlebar hover clears before native commands; stale CSS hover suppressed; pointer re-entry and blur, light/dark');
})().catch(e=>{console.error(e);process.exit(1);});
