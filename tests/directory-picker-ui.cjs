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
       if(cmd==='pick_workspace_directory') { if(window.pickFail) throw new Error('chooser'); return window.pickResult ?? null; }
       if(cmd==='dsh_webchat_url') return 'http://127.0.0.1:3080/mock-chat';
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
 await page.addInitScript({path:'src-tauri/src/directory-picker.js'});
 await page.route('http://127.0.0.1:3080/**',r=>r.fulfill({contentType:'text/html',body:'<button id="pick">Pick</button><textarea id="draft">Keep draft</textarea><script>document.querySelector("#pick").onclick=()=>window.__DSH_DIRECTORY_PICKER__.pick().then(path=>window.result={path},error=>window.result={error:error.message});</script>'}));
 await page.goto('http://127.0.0.1:1420/');
 await page.waitForFunction(()=>window.testCalls.some(c=>c.cmd==='plugin:event|listen' && c.args.event==='webchat-auth-hint'));
 await page.evaluate(()=>window.testEmit('app-update',{state:'none'}));


 await page.evaluate(()=>window.testReady());
 const frame=page.frameLocator('iframe.webchat');
 await frame.locator('#pick').waitFor();
 await page.evaluate(()=>window.pickResult='C:/测试/Workspace');
 await frame.locator('#pick').click();
 await frame.locator('body').evaluate(()=>new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(window.result){clearInterval(timer);resolve();}},10);setTimeout(()=>{clearInterval(timer);reject(new Error('no result'));},3000);}));
 assert.equal(await frame.locator('body').evaluate(()=>window.result.path),'C:/测试/Workspace');
 await page.evaluate(()=>window.pickResult=null);
 await frame.locator('body').evaluate(()=>window.result=undefined);
 await frame.locator('#pick').click();
 await page.waitForTimeout(100);
 assert.equal(await frame.locator('body').evaluate(()=>window.result.path),null);
 await page.evaluate(()=>window.pickFail=true);
 await frame.locator('#pick').click();
 await page.waitForTimeout(100);
 assert.match(await frame.locator('body').evaluate(()=>window.result.error),/Unable/);
 assert.equal(await frame.locator('#draft').inputValue(),'Keep draft');
 const before=await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='pick_workspace_directory').length);
 await page.evaluate(()=>{
   const source=document.querySelector('iframe').contentWindow;
   const data={type:'dsh-directory-pick',id:'12345678-1234-1234-1234-123456789abc'};
   window.dispatchEvent(new MessageEvent('message',{origin:'https://evil.example',source,data}));
   window.dispatchEvent(new MessageEvent('message',{origin:'http://127.0.0.1:3080',source:window,data}));
 });
 await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.cmd==='pick_workspace_directory').length),before);
 assert.deepEqual(errors,[]);
 await browser.close();
 console.log('PASS directory bridge selection/cancel/error; draft preserved; wrong origin/source blocked');
})().catch(e=>{console.error(e);process.exit(1);});
