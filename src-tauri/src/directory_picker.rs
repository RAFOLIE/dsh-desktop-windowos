//! Owned workspace chooser. Only the local shell calls this command.
use std::sync::atomic::{AtomicBool, Ordering};
static PICKING: AtomicBool = AtomicBool::new(false);
struct Picking;
impl Drop for Picking { fn drop(&mut self) { PICKING.store(false, Ordering::Release); } }

#[tauri::command]
pub async fn pick_workspace_directory(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    if window.label() != "main" { return Err("Unsupported window".into()); }
    if PICKING.swap(true, Ordering::AcqRel) { return Err("A directory chooser is already open".into()); }
    let guard = Picking;
    let owner = window.hwnd().map_err(|_| "Window is unavailable")?.0 as isize;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        unsafe { choose(owner).map_err(|e| format!("Directory chooser failed ({})", e.code())) }
    }).await.map_err(|_| "Directory chooser worker failed".to_string())?
}

unsafe fn choose(owner: isize) -> windows::core::Result<Option<String>> {
    use windows::Win32::{Foundation::HWND, System::Com::{CoInitializeEx, CoUninitialize, CoCreateInstance, CoTaskMemFree, COINIT_APARTMENTTHREADED, CLSCTX_INPROC_SERVER}, UI::Shell::{IFileOpenDialog, FileOpenDialog, FOS_PICKFOLDERS, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST, FOS_NOCHANGEDIR, SIGDN_FILESYSPATH}};
    CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
    struct Apartment;
    impl Drop for Apartment { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
    let _apartment = Apartment;
    let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
    dialog.SetOptions(dialog.GetOptions()? | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR)?;
    match dialog.Show(Some(HWND(owner as *mut _))) {
        Err(e) if e.code().0 as u32 == 0x800704c7 => return Ok(None),
        result => result?,
    }
    let path = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
    let result = path.to_string();
    CoTaskMemFree(Some(path.0.cast()));
    Ok(Some(result?))
}
