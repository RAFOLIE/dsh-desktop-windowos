import { invoke } from "@tauri-apps/api/core";

/** 「外观」preference persisted in settings.json (app_set_ui_theme). */
export type UiTheme = "system" | "dark" | "light";

let activePref: UiTheme = "system";

/** Resolve a preference to a concrete skin; "system" follows the OS. */
export function resolveSkin(pref: UiTheme): "dark" | "light" {
  if (pref !== "system") return pref;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Paint <html data-theme> for the whole shell; remembers the preference so
 *  the OS-flip watcher only acts while "system" is selected. */
export function applySkin(pref: UiTheme): "dark" | "light" {
  activePref = pref;
  const resolved = resolveSkin(pref);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

export function currentPref(): UiTheme {
  return activePref;
}

/** Re-apply on OS scheme flips (live, shell-side only — the embedded webchat
 *  picks the scheme up on next launch, see v1.6.34 issue #8 notes). Returns
 *  a cleanup function. */
export function watchSystemSkin(): () => void {
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!mq) return () => {};
  const cb = () => {
    if (currentPref() === "system") applySkin("system");
  };
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Read the persisted preference; anything unknown falls back to "system". */
export async function loadUiTheme(): Promise<UiTheme> {
  try {
    const s = await invoke<{ uiTheme?: string }>("app_get_shell_settings");
    return s.uiTheme === "dark" || s.uiTheme === "light" ? s.uiTheme : "system";
  } catch {
    return "system";
  }
}
