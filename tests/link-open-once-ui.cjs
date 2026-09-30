// Regression: one left-click on a link opens exactly ONE system browser tab.
//
// Two owners used to translate the same click into a new-window request:
//   1. the 3080 page's own link handler — MarkdownAnchor in
//      @deepseek-ai/dsh-client-ui-primitives (lib/index.js) renders external
//      links as <a target="_blank" onClick={preventDefault + open(href)}>, and
//      the chat plugin's openExternalLink (dsh-client-ui-chat/lib/client.js)
//      resolves that to window.open(url, "_blank", "noopener,noreferrer");
//   2. the shell's injected MENU_SCRIPT backstop, which ALSO called
//      window.open on every external anchor click.
// lib.rs maps each window.open to on_new_window -> opener().open_url, so the
// user got two identical tabs per click. The script extracted below is read
// from menu.rs at run time, so the test can never drift from the shipped
// source. The page-side handler is reproduced from the primitives bundle's
// contract (delegated at the #root container, bubble phase — React mounts into
// <div id="root"> per the shipped index.html).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const SCRIPT_ORIGIN = 'http://127.0.0.1:3080';

function shellScript() {
  const rust = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'src', 'menu.rs'), 'utf8');
  const body = rust.match(/pub\(crate\) const MENU_SCRIPT: &str = r#"([\s\S]*?)"#;/);
  assert.ok(body, 'MENU_SCRIPT not found in menu.rs');
  // Only the origin literal is rewritten, so the fixture can use a free port.
  const hits = body[1].split(SCRIPT_ORIGIN).length - 1;
  assert.equal(hits, 1, `expected exactly one ${SCRIPT_ORIGIN} literal in MENU_SCRIPT, found ${hits}`);
  return body[1].split(SCRIPT_ORIGIN).join('@@ORIGIN@@');
}

const FIXTURE = origin => `<!doctype html>
<html><body><div id="root">
  <p><a id="owned" href="https://example.com/owned" target="_blank" rel="noopener noreferrer">owned by the page</a></p>
  <p><a id="bare"  href="https://example.com/bare"  target="_blank" rel="noopener noreferrer">no page handler</a></p>
  <p><a id="local" href="/local">in-shell</a></p>
</div>
<script>
  // Mirrors MarkdownAnchor's onClick, delegated at the React root container.
  document.getElementById('root').addEventListener('click', function (event) {
    var a = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!a || a.id !== 'owned') return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.open(a.href, '_blank', 'noopener,noreferrer');
  });
</script>
</body></html>`;

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(FIXTURE(`http://127.0.0.1:${server.address().port}`));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: process.env.DSH_BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://example.com/**', r => r.fulfill({ contentType: 'text/html', body: 'ok' }));
  await page.addInitScript(() => {
    window.__opens = [];
    window.open = function (url) { window.__opens.push(String(url)); return null; };
  });
  await page.addInitScript({ content: shellScript().split('@@ORIGIN@@').join(origin) });
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__dshLinkMenu);

  const click = async (id, options) => {
    await page.evaluate(() => { window.__opens = []; });
    await page.locator(`#${id}`).click(options);
    await page.waitForTimeout(120);
    return page.evaluate(() => window.__opens);
  };

  // 1. The page owns this link: its handler opens it, the shell must stand down.
  const owned = await click('owned');
  assert.deepEqual(owned, ['https://example.com/owned'], `owned link opened ${owned.length} time(s)`);

  // 2. No page handler (the issue #7 shape): the shell backstop still opens it.
  const bare = await click('bare');
  assert.deepEqual(bare, ['https://example.com/bare'], `unowned link opened ${bare.length} time(s)`);

  // 3. In-shell href: neither owner opens anything.
  assert.deepEqual(await click('local'), [], 'in-shell link left the shell');

  // 4. Modified click: both owners decline (native new-tab is the browser's job).
  assert.deepEqual(await click('owned', { modifiers: ['Control'] }), [], 'ctrl+click was hijacked');

  // 5. The right-click menu still opens the link exactly once.
  await page.locator('#owned').click({ button: 'right' });
  const row = page.locator('text=在浏览器中打开');
  await row.waitFor({ state: 'visible', timeout: 3000 });
  await page.evaluate(() => { window.__opens = []; });
  await row.click();
  await page.waitForTimeout(120);
  const menuOpens = await page.evaluate(() => window.__opens);
  assert.deepEqual(menuOpens, ['https://example.com/owned'], `context menu opened ${menuOpens.length} time(s)`);

  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log('PASS one left-click opens exactly one browser tab; page-owned, unowned, in-shell, modified and context-menu paths all open 0 or 1 times');
})().catch(e => { console.error(e); process.exit(1); });
