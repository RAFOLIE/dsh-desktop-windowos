import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, validateAppearance, importTheme, exportTheme, preset, tokens, contrastRatio, fontStack } from '../src/appearanceModel.ts';
test('both themes round-trip independently with a versioned destination', () => {
  for (const scheme of ['light', 'dark']) {
    const theme = { ...preset(scheme), accent: '#abcdef', contrast: 80 };
    assert.deepEqual(importTheme(exportTheme(scheme, theme)), { scheme, theme });
  }
  assert.deepEqual(validateAppearance(defaults()), defaults());
});
test('rejects malformed and out-of-range imports', () => {
  const payload = JSON.parse(exportTheme('dark', preset('dark')));
  for (const patch of [{ version: 2 }, { scheme: 'system' }, { css: 'body{display:none}' }, { theme: { ...payload.theme, accent: 'red;display:none' } }, { theme: { ...payload.theme, contrast: 101 } }]) {
    assert.throws(() => importTheme(JSON.stringify({ ...payload, ...patch })));
  }
  assert.throws(() => importTheme('x'.repeat(8193)));
  assert.throws(() => validateAppearance({ ...defaults(), uiSize: 99 }));
  assert.throws(() => validateAppearance({ ...defaults(), codeFont: 'url(https://x)' }));
});
test('surface contrast changes tonal hierarchy, preserving base and text colors', () => {
  for (const scheme of ['dark', 'light']) {
    const theme = preset(scheme);
    const a = tokens({ ...theme, contrast: 0 });
    const b = tokens({ ...theme, contrast: 100 });
    assert.notEqual(a['--ep-line'], b['--ep-line']);
    assert.notEqual(a['--ep-card'], b['--ep-card']);
    assert.equal(a['--ep-bg'], b['--ep-bg']);
    assert.equal(a['--ep-text'], b['--ep-text']);
    for (const accent of ['#ffffff', '#000000', '#55ffaa', '#4d6bfe']) {
      const values = tokens({ ...theme, accent });
      assert.ok(contrastRatio(accent, values['--on-accent']) >= 4.5);
    }
  }
});
test('local font names are quoted and retain appropriate fallback families', () => {
  assert.match(fontStack('Missing font'), /"Missing font", system-ui/);
  assert.match(fontStack('微软雅黑'), /"微软雅黑"/);
  assert.match(fontStack('Missing code font', true), /monospace$/);
  assert.throws(() => fontStack('Arial";display:none'));
});

test('optional frame color preserves old themes and round trips new ones', () => {
  const original=preset('dark');
  const theme={...original,frame:'#ffffff'};
  assert.deepEqual(importTheme(exportTheme('dark',theme)).theme,theme);
  assert.equal(tokens(theme)['--frame-bg'],'#ffffff');
  assert.equal(tokens(theme)['--ep-bg'],original.background);
  assert.equal(tokens(theme)['--frame-text'],theme.foreground);
  assert.deepEqual(validateAppearance({...defaults(),dark:original}).dark,original);
  assert.throws(()=>importTheme(JSON.stringify({...JSON.parse(exportTheme('dark',theme)),theme:{...theme,frame:'red'}})));
});

test('foreground surface and text preserve unrestricted user colors', () => {
  const theme={...preset('light'),background:'#fa0000',surface:'#191919'};
  const values=tokens(theme);
  assert.equal(values['--ep-bg'],'#fa0000');
  assert.equal(values['--ep-card'],'#191919');
  assert.equal(values['--surface-text'],theme.foreground);
  assert.deepEqual(importTheme(exportTheme('light',theme)).theme,theme);
  assert.deepEqual(validateAppearance({...defaults(),light:{...preset('light'),background:'#242424',surface:'#242424',foreground:'#242424'}}).light,{...preset('light'),background:'#242424',surface:'#242424',foreground:'#242424'});
});
