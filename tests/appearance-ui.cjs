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
 await page.evaluate(()=>window.testReady());
 await page.locator('iframe').waitFor();
 await page.frameLocator('iframe').locator('#draft').fill('Keep this conversation draft');
 await page.evaluate(()=>window.testEmit('web-open-status','auth'));
 await page.getByRole('status').filter({hasText:'无法取得当前后端'}).waitFor();
 await page.getByRole('button',{name:'关闭提示',exact:true}).click();
 await page.evaluate(()=>window.testEmit('web-open-status','waiting'));
 await page.getByRole('status').filter({hasText:'正在等待 DSH'}).waitFor();
 await page.evaluate(()=>window.testEmit('web-open-status','idle'));
 await page.waitForFunction(()=>!document.querySelector('.web-hint-dismiss'));

 await page.locator('.tb-pill').click();
 await page.getByRole('heading',{name:'常规',exact:true}).waitFor();

 const general = page.getByRole('button',{name:'常规',exact:true});
 const appearance = page.getByRole('button',{name:'外观',exact:true});
 assert.equal(await page.getByText('语言 / Language',{exact:false}).count(),1);
 await appearance.click();
 assert.equal(await page.getByText('语言 / Language',{exact:false}).count(),0);
 await page.getByRole('article',{name:'浅色主题',exact:true}).waitFor();
 await page.screenshot({path:output+'/dsh-appearance-dark.png'});
 const darkAccent=page.getByRole('textbox',{name:'深色主题 强调色 HEX',exact:true});
 await darkAccent.fill('#ff8800'); await darkAccent.press('Enter');
 assert.equal(await page.locator('html').evaluate(e=>e.style.getPropertyValue('--accent')),'#ff8800');
 const lightAccent=page.getByRole('textbox',{name:'浅色主题 强调色 HEX',exact:true});
 await lightAccent.fill('#008855'); await lightAccent.press('Enter');
 assert.equal(await page.locator('html').evaluate(e=>e.style.getPropertyValue('--accent')),'#ff8800');
 await page.getByRole('radio',{name:'浅色',exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 assert.equal(await page.locator('html').evaluate(e=>e.style.getPropertyValue('--accent')),'#008855');
 await page.getByRole('combobox',{name:'界面字号',exact:true}).selectOption('18');
 await page.getByRole('combobox',{name:'代码字号',exact:true}).selectOption('20');
 assert.equal(await page.locator('.ep-tab').first().evaluate(e=>getComputedStyle(e).fontSize),'18px');
 assert.equal(await page.locator('.ap-preview code').first().evaluate(e=>getComputedStyle(e).fontSize),'20px');
 const fontInput=page.getByRole('combobox',{name:'界面字体',exact:true});
 await fontInput.fill('Missing font'); await fontInput.press('Enter');
 assert.match(await page.locator('.ep-tab').first().evaluate(e=>getComputedStyle(e).fontFamily),/Missing font/);
 await page.getByRole('switch',{name:'半透明侧栏',exact:true}).click();
 assert.equal(await page.locator('html').getAttribute('data-translucent'),'true');
 await page.getByRole('switch',{name:'手形光标',exact:true}).click();
 assert.equal(await appearance.evaluate(e=>getComputedStyle(e).cursor),'default');
 await lightAccent.fill('#fafafa'); await lightAccent.press('Enter');
 // Invalid foreground must not destroy the current readable theme.
 const foreground=page.getByRole('textbox',{name:'浅色主题 文字颜色 HEX',exact:true});
 await foreground.fill('#fafafa'); await foreground.press('Enter');
 assert.equal(await foreground.inputValue(),'#242424');
 assert.ok((await page.getByRole('alert').innerText()).includes('3:1'));
 await page.getByRole('article',{name:'深色主题',exact:true}).getByRole('button',{name:'复制主题',exact:true}).click();
 assert.equal(await page.evaluate(()=>JSON.parse(window.copiedTheme).scheme),'dark');
 await page.evaluate(()=>window.clipboardFail=true);
 await page.getByRole('article',{name:'浅色主题',exact:true}).getByRole('button',{name:'复制主题',exact:true}).click();
 assert.ok((await page.getByRole('textbox',{name:'DSH 主题 JSON'}).inputValue()).includes('"scheme": "light"'));
 await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.evaluate(()=>window.storageFail=true);
 const previous=await lightAccent.inputValue();
 await lightAccent.fill('#123456');await lightAccent.press('Enter');
 assert.equal(await lightAccent.inputValue(),previous);
 assert.ok((await page.getByRole('alert').innerText()).includes('保存失败'));
 await page.evaluate(()=>window.storageFail=false);
 await page.getByRole('button',{name:'导入主题',exact:true}).click();
 const before=await page.evaluate(()=>localStorage.getItem('dsh.appearance.v1'));
 await page.getByRole('textbox',{name:'DSH 主题 JSON'}).fill('{"version":99}');
 await page.getByRole('button',{name:'导入',exact:true}).click();
 assert.equal(await page.evaluate(()=>localStorage.getItem('dsh.appearance.v1')),before);
 await page.getByRole('textbox',{name:'DSH 主题 JSON'}).fill(JSON.stringify({format:'dsh-theme',version:1,scheme:'dark',theme:{accent:'#8877ff',background:'#141824',foreground:'#eeeeff',contrast:65}}));
 await page.getByRole('button',{name:'导入',exact:true}).click();
 assert.equal(await page.locator('.ap-transfer').count(),0);
 await page.waitForFunction(()=>document.querySelector('[aria-label="深色主题 强调色 HEX"]').value==='#8877ff');
 await page.getByRole('radio',{name:'深色',exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 await page.getByRole('button',{name:'返回聊天',exact:true}).click();
 assert.equal(await page.frameLocator('iframe').locator('#draft').inputValue(),'Keep this conversation draft');
 await page.locator('.tb-pill').click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="深色主题 强调色 HEX"]').value==='#8877ff');
 await page.reload();
 await page.waitForFunction(()=>window.testCalls.some(c=>c.cmd==='plugin:event|listen'&&c.args.event==='webchat-auth-hint'));
 await page.evaluate(()=>window.testReady());
 await page.locator('.tb-pill').click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="深色主题 强调色 HEX"]').value==='#8877ff');
 assert.equal(await page.getByRole('combobox',{name:'界面字号',exact:true}).inputValue(),'18');
 await page.getByRole('radio',{name:'跟随系统',exact:true}).click();
 await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 await page.emulateMedia({colorScheme:'dark'});
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 for(const width of [560,760,1100,1440]) {
   await page.setViewportSize({width,height:960});
   assert.ok(await page.locator('.ep-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'appearance overflow '+width);
 }
 await page.getByRole('button',{name:'重置全部外观',exact:true}).click();
 await page.getByRole('button',{name:'重置',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="深色主题 强调色 HEX"]').value==='#4d6bfe');
 await page.getByRole('radio',{name:'深色',exact:true}).click();
 await page.waitForTimeout(4200);
 await page.screenshot({path:output+'/dsh-appearance-dark.png'});
 await page.getByRole('radio',{name:'浅色',exact:true}).click();
 await page.waitForTimeout(250);
 await page.screenshot({path:output+'/dsh-appearance-light.png'});
 await page.setViewportSize({width:760,height:960});
 await page.screenshot({path:output+'/dsh-appearance-narrow.png'});
 await page.setViewportSize({width:1440,height:960});
 await general.click();
 for(const language of ['English','日本語','한국어','Русский','繁體中文','简体中文']) {
   await page.locator('.ep-select').first().click();
   await page.getByRole('option',{name:language,exact:true}).click();
   await page.locator('.ep-tab').nth(1).click();
   assert.equal(await page.locator('.ap-theme-card').count(),2);
   await page.locator('.ep-tab').first().click();
 }
 await page.getByRole('textbox',{name:'搜索设置…'}).fill('字体');
 assert.ok(await page.locator('.ep-search-result').count()>0);
 assert.deepEqual(errors,[]);
 console.log('PASS: language migration, themes, colors, independent preview, font and sizes, translucency, pointer, import validation, persistence, system theme, reset, six languages, responsive, persistent chat, no browser errors');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
