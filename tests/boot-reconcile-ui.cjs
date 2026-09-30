const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const output = process.env.DSH_SCREENSHOT_DIR || require('node:path').join(require('node:os').tmpdir(),'dsh-appearance-check');
fs.mkdirSync(output,{recursive:true});
(async () => {
  const browser = await chromium.launch({channel:'msedge', headless:true});
  const errors=[];
  // `pull` decides what the mount-time dsh_current_status answers: a payload,
  // nothing at all (undefined → the command's JSON null), or `deferred`, which
  // parks the answer so the test controls exactly when a stale one lands.
  const mockInit=pull=>{
    const callbacks={}, events={}; let n=0;
    window.testCalls=[];
    window.testEmitted=[];
    window.testResolvePull=null;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
    window.__TAURI_INTERNALS__={
      transformCallback(fn){callbacks[++n]=fn; return n;},
      async invoke(cmd,args={}){
        window.testCalls.push({cmd,args});
        if(cmd==='plugin:event|listen') {events[args.event]=callbacks[args.handler]; return ++n;}
        if(cmd==='dsh_current_status') {
          if(pull.mode==='deferred') return new Promise(resolve=>{window.testResolvePull=resolve;});
          return pull.payload||null;
        }
        if(cmd==='app_get_shell_settings') return {closeAction:'tray',alwaysOnTop:false,autostart:false,uiTheme:'dark',uiLocale:'zh',uiLocaleResolved:'zh'};
        if(cmd==='env_info') return {app:{version:'1.6.50',installDir:'C:\\DSH'},dsh:{portAnswering:true,webVersion:'0.1.5-rc.1',owner:{pid:14280,owned:true,cmd:'node dsh web',chain:'dsh-desktop → node'},whereDsh:'C:\\Users\\Example\\AppData\\Roaming\\npm\\dsh.cmd'},node:{version:'v24.13.0',path:'C:\\Program Files\\nodejs\\node.exe'},plugins:{dshDesktopPlugin:'1.5.13'},profileDir:'C:\\Users\\Example\\.dsh\\profiles\\web',workspaceDir:'C:\\Users\\Example\\Documents\\ChatGPT\\DSH',logDir:'C:\\Users\\Example\\AppData\\Local\\dsh-desktop\\logs',profileSizeBytes:8430000};
        if(cmd==='dsh_webchat_url') return 'http://127.0.0.1:1420/mock-chat';
        if(cmd==='app_web_open_status') return 'idle';
        if(cmd==='app_get_update_config') return {channel:'stable',autoUpdate:true};
        if(cmd==='window_shell_ready') return;
        return null;
      }
    };
    window.testEmit=(name,payload)=>{window.testEmitted.push(name);events[name]?.({payload});};
    window.testCalled=cmd=>window.testCalls.some(c=>c.cmd===cmd);
  };
  const newPage=async pull=>{
    const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(mockInit, pull);
    await page.route('**/mock-chat',r=>r.fulfill({contentType:'text/html',body:'<textarea id="draft">Persistent draft</textarea>'}));
    return page;
  };

  // 1. The reported bug: the shell's single re-push after a reload is lost, so
  //    no dsh-status event ever arrives. The page must still reconcile itself
  //    from the pull instead of sitting on 「正在启动 DSH…」 forever.
  const page1=await newPage({payload:{status:'ready',attached:false}});
  await page1.goto('http://127.0.0.1:1420/');
  await page1.locator('.webchat').waitFor({state:'visible'});
  assert.equal(await page1.locator('.boot-wrap').count(),0,'boot view survived a ready pull');
  assert.deepEqual(await page1.evaluate(()=>window.testEmitted),[],'case 1 must run without any dsh-status push');
  assert.equal(await page1.evaluate(()=>window.testCalled('dsh_webchat_url')),true,'pull did not run the shared ready transition');
  await page1.screenshot({path:require('node:path').join(output,'boot-reconcile-1-lost-push.png')});
  await page1.close();

  // 2. Anti-race: an event-delivered ready wins, and the pull that finally
  //    answers still holding the pre-event `starting` must be discarded.
  const page2=await newPage({mode:'deferred'});
  await page2.goto('http://127.0.0.1:1420/');
  await page2.waitForFunction(()=>window.testCalled('dsh_current_status'));
  await page2.evaluate(()=>window.testEmit('dsh-status',{status:'ready',attached:false}));
  await page2.locator('.webchat').waitFor({state:'visible'});
  await page2.evaluate(()=>window.testResolvePull({status:'starting',method:'dsh web'}));
  // app_web_open_status is invoked right after the pull is settled, so its
  // arrival proves the stale answer has already been through the apply gate.
  await page2.waitForFunction(()=>window.testCalled('app_web_open_status'));
  assert.equal(await page2.locator('.webchat').isVisible(),true,'stale pull clobbered a newer event');
  assert.equal(await page2.locator('.boot-wrap').count(),0,'stale pull put the boot view back');
  await page2.screenshot({path:require('node:path').join(output,'boot-reconcile-2-stale-pull.png')});
  await page2.close();

  // 3. Nothing reported yet: a null pull is silent (no crash, no new state),
  //    and the push path still brings the chat up afterwards.
  const page3=await newPage({});
  await page3.goto('http://127.0.0.1:1420/');
  await page3.waitForFunction(()=>window.testCalled('app_web_open_status'));
  await page3.locator('.boot-wrap').waitFor();
  assert.equal(await page3.locator('.webchat').count(),0,'null pull mounted the webchat anyway');
  assert.deepEqual(errors,[],'null pull crashed the page');
  await page3.evaluate(()=>window.testEmit('dsh-status',{status:'ready',attached:false}));
  await page3.locator('.webchat').waitFor({state:'visible'});
  assert.equal(await page3.locator('.boot-wrap').count(),0,'push path stopped working');
  await page3.screenshot({path:require('node:path').join(output,'boot-reconcile-3-null-pull.png')});
  await page3.close();

  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('PASS: boot reconciles from a lost re-push; stale pull discarded; null pull silent, push still works');
})().catch(e=>{console.error(e);process.exit(1);});
