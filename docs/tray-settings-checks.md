# Tray activation and window restoration — v1.6.68

General settings expose Single click / Double click. Missing or unknown settings use double click. Native settings.json stores trayClickAction; invalid input, malformed files and write errors fail without reporting a successful UI save. Other settings survive the update. The tray tooltip follows mode and locale immediately. Left-button release opens in single mode, left-button double-click opens in double mode; right and middle clicks do not trigger activation. The right-click menu remains available.

All existing open-window routes use show_main_window, now show → unminimize → focus. The isolated Tauri native-window test exercises this production helper: minimized → visible/restored, hidden → visible, maximized → minimized → restored while retaining maximization. It does not start a backend or use the user's tray/window. It passed on Windows. Actual physical tray clicks were not automated; event-policy tests cover the native event mapping.

Verification:
- Rust unit tests include gesture selection and a temporary on-disk settings save/reload test, preservation of unrelated fields, invalid selection and malformed JSON rejection.
- node tests/tray-settings-ui.cjs with a Vite server and PLAYWRIGHT_MODULE: default, save, panel remount, failed save, Chinese dark and English light rendering. Screenshots inspected.
- Native test is opt-in: powershell -File tests/tray-native-smoke.ps1. It needs Windows SDK mt.exe. The native-smoke feature isolates GUI dependencies from ordinary tests; Cargo's test executable needs an explicit Common Controls v6 manifest, otherwise Windows reports STATUS_ENTRYPOINT_NOT_FOUND before tests start. The helper embeds this manifest into the test executable only, never into a released binary.
- pnpm tauri build creates the production executable with its normal Tauri manifest and embedded assets.

The new desktop executable is synced locally after verification; existing user processes/backends are not forcibly restarted. No release or issue comment is made as part of this local implementation.
