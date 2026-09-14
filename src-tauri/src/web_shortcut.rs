//! Credential-free desktop entry point. Resolve auth only when clicked.
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;

pub const WEB_URI: &str = "dsh-desktop-web://open";
static OPENING: AtomicBool = AtomicBool::new(false);
static STATUS: Mutex<&str> = Mutex::new("idle");

pub fn status() -> String { STATUS.lock().map(|v| v.to_string()).unwrap_or_else(|_| "failed".into()) }
fn report(app: &AppHandle, value: &'static str) {
    if let Ok(mut state) = STATUS.lock() { *state = value; }
    let _ = app.emit("web-open-status", value);
}
pub fn requested(args: &[String]) -> bool { args.iter().skip(1).any(|s| s == "--open-web") }

pub fn open(app: AppHandle) {
    if OPENING.swap(true, Ordering::SeqCst) { return; }
    std::thread::spawn(move || {
        struct Guard;
        impl Drop for Guard { fn drop(&mut self) { OPENING.store(false, Ordering::SeqCst); } }
        let _guard = Guard;
        report(&app, "waiting");
        let started = Instant::now();
        loop {
            use crate::startup_policy::{web_wait, WebWait};
            let active = crate::dsh::startup_active() || crate::backend_update::busy();
            match web_wait(crate::dsh::probe_ready_once(), active, crate::dsh::startup_terminal(), started.elapsed()) {
                WebWait::Open => break,
                WebWait::Waiting => std::thread::sleep(Duration::from_millis(500)),
                verdict => {
                    report(&app, if verdict == WebWait::Failed { "failed" } else { "timeout" });
                    crate::show_main_window(&app);
                    return;
                }
            }
        }
        match crate::dsh::external_browser_url() {
            Ok(url) => {
                // Never log the URL or opener errors, which can contain the token.
                if app.opener().open_url(&url, None::<&str>).is_ok() { report(&app, "idle"); }
                else { report(&app, "failed"); crate::show_main_window(&app); }
            }
            Err(reason) => { report(&app, reason); crate::show_main_window(&app); }
        }
    });
}

/// Migrate only this application's legacy loopback shortcut. Preserve custom
/// URLs, arbitrary files and all non-URL fields. No credential is persisted.
pub fn migrate(text: &str) -> Option<String> {
    if !text.trim_start_matches('\u{feff}').lines().any(|l| l.trim().eq_ignore_ascii_case("[InternetShortcut]")) { return None; }
    let mut changed = false;
    let lines: Vec<String> = text.trim_start_matches('\u{feff}').lines().map(|line| {
        if let Some((key, value)) = line.split_once('=') {
            if key.trim().eq_ignore_ascii_case("URL") && matches!(value.trim(), "http://127.0.0.1:3080" | "http://127.0.0.1:3080/") {
                changed = true;
                return format!("URL={WEB_URI}");
            }
        }
        line.to_owned()
    }).collect();
    changed.then(|| format!("{}\r\n", lines.join("\r\n")))
}

#[cfg(windows)]
pub fn install() -> Result<(), String> {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let value = executable.to_string_lossy();
    let exe = value.strip_prefix(r"\\?\").unwrap_or(&value);
    // A development build must never steal the installed application's handler.
    if cfg!(debug_assertions) { return Ok(()); }
    let (root, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(r"Software\Classes\dsh-desktop-web").map_err(|e| e.to_string())?;
    root.set_value("", &"URL:DeepSeek Harness Web").map_err(|e| e.to_string())?;
    root.set_value("URL Protocol", &"").map_err(|e| e.to_string())?;
    let (icon, _) = root.create_subkey("DefaultIcon").map_err(|e| e.to_string())?;
    icon.set_value("", &format!("\"{exe}\",0")).map_err(|e| e.to_string())?;
    let (command, _) = root.create_subkey(r"shell\open\command").map_err(|e| e.to_string())?;
    // Deliberately no %1: this handler performs one fixed action and accepts
    // no URL, path, shell expression or credentials from the invoking page.
    command.set_value("", &format!("\"{exe}\" --open-web")).map_err(|e| e.to_string())?;
    repair_shortcut();
    // Published legacy plugins can recreate the old .url while DSH activates.
    // Only read one tiny existing file; unchanged/custom/deleted files stay so.
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(3));
        repair_shortcut();
    });
    Ok(())
}
#[cfg(windows)]
fn repair_shortcut() {
    let Some(desktop) = dirs::desktop_dir() else { return; };
    let path = desktop.join("DeepSeek Harness Web.url");
    let Ok(meta) = std::fs::metadata(&path) else { return; };
    if meta.len() > 16_384 { return; }
    let Ok(text) = std::fs::read_to_string(&path) else { return; };
    let Some(next) = migrate(&text) else { return; };
    let staged = path.with_extension("url.migrating");
    if std::fs::write(&staged, next).is_ok() {
        // Do not overwrite a customization made while we prepared the file.
        if std::fs::read_to_string(&path).ok().as_deref() == Some(&text) {
            let _ = std::fs::rename(&staged, &path);
        } else { let _ = std::fs::remove_file(staged); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrate_only_known_local_shortcut() {
        let original = "[InternetShortcut]\r\nURL=http://127.0.0.1:3080\r\nIconFile=C:\\Example\\app.exe\r\nIconIndex=0\r\n";
        let updated = migrate(original).unwrap();
        assert!(updated.contains(WEB_URI));
        assert!(updated.contains("IconFile=C:\\Example\\app.exe"));
        assert!(!updated.contains("token="));
        assert!(migrate(&updated).is_none());
        assert!(migrate(&original.replace("3080", "8080")).is_none());
        assert!(migrate(&original.replace("http://127.0.0.1:3080", "https://example.com")).is_none());
        assert!(migrate(&original.replace("http://127.0.0.1:3080", "http://127.0.0.1:3080/?token=custom")).is_none());
        assert!(migrate("URL=http://127.0.0.1:3080").is_none());
    }
    #[test]
    fn only_exact_open_flag_dispatches() {
        assert!(requested(&["app.exe".into(), "--open-web".into()]));
        assert!(!requested(&["app.exe".into(), "https://example.com/--open-web".into()]));
        assert!(!requested(&["app.exe".into(), "--open-web=anything".into()]));
    }
}
