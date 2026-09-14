import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionRelation, jobBusy, manualCommand } from '../src/backendUpdateModel.ts';

test('channel comparison handles prereleases, numeric identifiers and releases', () => {
  assert.equal(versionRelation('0.1.5-rc.2', '0.1.5-rc.1'), 'ahead');
  assert.equal(versionRelation('0.1.5-rc.2', '0.1.5-rc.2'), 'equal');
  assert.equal(versionRelation('0.1.5-rc.2', '0.1.5-rc.10'), 'newer');
  assert.equal(versionRelation('0.1.5-alpha.2', '0.1.5-rc.1'), 'newer');
  assert.equal(versionRelation('0.1.5-rc.2', '0.1.5'), 'newer');
  assert.equal(versionRelation('0.1.5+build1', '0.1.5+build2'), 'equal');
  assert.equal(versionRelation('0.1.6-alpha.1', '0.1.5'), 'ahead');
});
test('unknown versions and absent tags cannot enable installation', () => {
  for (const value of [undefined, null, '', 'unknown', 'release-branch']) {
    assert.equal(versionRelation(value, '0.1.5'), 'unknown');
    assert.equal(versionRelation('0.1.5', value), 'unknown');
  }
});
test('install and restart are not completion', () => {
  for (const phase of ['checking','installing','restarting','verifying']) assert.equal(jobBusy({phase}), true);
  for (const phase of ['succeeded','failed']) assert.equal(jobBusy({phase}), false);
  assert.equal(jobBusy(null), false);
});
test('manual commands target only recognized sources, pin a version and quote the prefix', () => {
  const cmd = manualCommand({kind:'global',prefix:"C:\\Users\\O'Brien\\npm"}, '0.1.5-rc.2');
  assert.ok(cmd.includes("'C:\\Users\\O''Brien\\npm'"));
  assert.ok(cmd.includes('@deepseek-ai/dsh@0.1.5-rc.2'));
  assert.equal(manualCommand({kind:'local'}, '0.1.5'), null);
  assert.equal(manualCommand({kind:'custom'}, '0.1.5'), null);
  assert.equal(manualCommand(null, '0.1.5'), null);
  assert.equal(manualCommand({kind:'npx'}, '0.1.5'), 'npx @deepseek-ai/dsh@0.1.5 web');
  assert.equal(manualCommand({kind:'global',prefix:'C:/npm'}, 'latest; calc'), null);
});
