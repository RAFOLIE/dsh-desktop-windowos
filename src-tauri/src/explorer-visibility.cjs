// Desktop-owned DSH compatibility: Explorer is a GUI application. Hiding it
// hides the delegated folder window on Windows (DSH 0.1.7-rc.2).
// Keep every other command and every other execFile option unchanged.
'use strict';
const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const path = require('node:path');
const { promisify } = require('node:util');
const original = childProcess.execFile;
function isExplorer(file) {
  if (typeof file !== 'string') return false;
  if (file.toLowerCase() === 'explorer.exe') return true;
  const root = process.env.SystemRoot;
  return Boolean(root) && path.win32.normalize(file).toLowerCase() ===
    path.win32.join(root, 'explorer.exe').toLowerCase();
}
function visibleExplorerArgs(args) {
  const index = Array.isArray(args[1]) ? 2 : 1;
  const options = args[index];
  if (process.platform === 'win32' && isExplorer(args[0]) &&
      options && typeof options === 'object' && options.windowsHide === true) {
    args[index] = { ...options, windowsHide: false };
  }
  return args;
}
childProcess.execFile = function (...args) {
  return Reflect.apply(original, this, visibleExplorerArgs(args));
};
// Keep Node's promisify result shape ({ stdout, stderr }) and .child handle.
childProcess.execFile[promisify.custom] = function (...args) {
  return Reflect.apply(original[promisify.custom], this, visibleExplorerArgs(args));
};
// DSH imports execFile using ESM; update that binding before its modules load.
syncBuiltinESMExports();
