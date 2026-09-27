# Issues 13 / 14 / 15 verification — 2026-09-27

## #15: Explorer is launched but hidden

Reporter: DSH 0.1.7-rc.2 + desktop v1.6.63. User's own installation can open folders; this is not a universal failure. The official 0.1.7-rc.2 dsh-native-command switches directory opening from PowerShell Invoke-Item to explorer.exe, while its shared execFile runner still passes windowsHide: true. File reveal uses the same runner.

An isolated exact-version DSH, fresh DSH_HOME and random port showed:

- standalone browser and cross-site iframe: apps endpoint 200;
- nonexistent directory: expected 404, not an authentication failure;
- existing fixture directory: open endpoint 200 with `{ok:true}`;
- before compatibility preload: Explorer COM Visible=false and Win32 IsWindowVisible=false;
- after preload: both values true.

The earlier cross-site-fetch hypothesis was rejected: iframe-origin fetch sends Sec-Fetch-Site: same-origin. No request headers or authentication rules are changed.

Desktop-owned backend startup now supplies a content-addressed Node preload through the child command's NODE_OPTIONS, preserving existing NODE_OPTIONS. It changes only execFile calls targeting explorer.exe or the SystemRoot Explorer executable when windowsHide is explicitly true. Other arguments, callbacks, abort signals, native Promise output and child handles remain intact. ESM bindings are synchronized. No upstream installed files or global environment are modified. The preload is inherited within that backend's Node process tree; attaching to an already-running external backend cannot retrofit it, so restart that backend from the updated desktop to apply.

Tests: `node --test tests/explorer-visibility.test.cjs`; opt-in real Explorer regression `node tests/explorer-visibility-live.cjs` with DSH_NATIVE_COMMAND_MODULE pointing to the exact official native-command module. The live test checks open and reveal with Unicode, comma and equals characters, confirms hidden before / visible after, and closes only its fresh test windows. Production Rust tests: 28 passed, 4 opt-in ignored. With the preload enabled, both 0.1.6-alpha.2 and 0.1.7-alpha.2 passed the real startup/auth/browser/iframe/draft/reload matrix. This reproduces a matching failure mode, not a confirmation from the issue reporter's machine.

## #14: configuration docs and migrated shortcuts

No GUI switch exists. Both READMEs now document the profile patch path, merging by id, restart and non-deletion behavior. Turning switches off does not delete existing files or moved copies. The plugin preserves an existing dsh-desktop-web://open entry when configured for the default 127.0.0.1:3080 URL, honors explicit custom URLs, and continues to create absent shortcuts. Disabled creation performs no reads/writes. Plugin unit tests: 29 passed; typecheck/build passed. Generated plugin lib artifacts are included. These source changes are not yet published to npm; installed npm 1.5.12 retains its old rewriting behavior and the running desktop's repair remains necessary.

## #13: existing fix retained

Installed candidates retain 120 seconds; npx retains 300 seconds. Capability inspection reads files without spawning web --help. Startup policy and lock-diagnostic tests pass. Reporter retest remains outstanding; no issue was closed or commented on during this work.
