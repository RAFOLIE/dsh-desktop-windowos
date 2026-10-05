# Issues #18 and #19 — local v1.6.71 candidate

## Evidence and changes

Compared published @deepseek-ai/dsh-api-gateway, dsh-api-session-controller, dsh-host-directory-picker-native and dsh-client-ui-directory-picker-native 0.2.0-rc.2 packages. Only downloaded packages to TEMP; no global backend upgrade or package mutation.

#18: api-session/added is also emitted on agent created/disposed, and its summary includes running. The previous desktop handler unconditionally reset the tracked state to false. Preserve known running edges across availability refreshes, seed a running summary, and continue deduplicating idle frames. Suppress completion notifications only while the window is visible, not minimized, and focused. A mux logical error now reconnects instead of leaving an inert connection; backoff cannot underflow after orderly closure. Record ready, completion/suppression and Windows toast rejection without session titles or credentials. Decline interactive waterfall events with outcome next so this passive observer does not hold the gateway's interactive flow open.

#19: use the officially supplied __DSH_DIRECTORY_PICKER__.pick hook. The local shell accepts only requests from its mounted 127.0.0.1:3080 iframe and returns string/null/error. A single-flight COM IFileOpenDialog uses the main HWND as owner, with filesystem/folder/existing-path/no-change-directory flags, on an STA worker. No remote Tauri capability is added. Existing backends without the hook retain their existing selector. No reload, simulated input or force-focus loop is used; page drafts remain intact.

## Validation and limits

- Rust tests: 40 passed, 4 opt-in ignored, including event refresh/finish ordering, running summary, logical error, passive interactive event and notification visibility policy.
- tests/directory-picker-ui.cjs: real cross-origin browser frames with native command mocked; select Unicode path, cancel, error, retained draft, wrong source/origin rejection pass.
- pnpm tauri build includes TypeScript validation and production embedding.
- The reporter's Windows 10/WebView2 154 rendering failure has NOT been reproduced locally. This is a targeted replacement of the external ownerless picker, not proof of the inferred frame-production cause.
- No live model task was sent and no user's backend was stopped. Actual completion toast and native directory-selection flow need local/reporter verification. Neither issue should be closed until confirmation.
- Local candidate only: no release, npm publish or issue comment in this implementation turn.