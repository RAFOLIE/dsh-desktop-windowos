//! Backend package updates: identify the live installation, pin the version,
//! keep an app-lifetime job, and verify a new process before reporting success.
use crate::dsh;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub kind: String,
    pub path: Option<String>,
    pub version: Option<String>,
    pub pid: Option<u64>,
    pub managed: bool,
    pub prefix: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub phase: String,
    pub target: String,
    pub error: Option<String>,
    pub failed_phase: Option<String>,
    pub installation_started: bool,
    pub elapsed_seconds: u64,
    pub budget_seconds: Option<u64>,
    #[serde(skip)]
    phase_started: Option<Instant>,
}
static JOB: Mutex<Option<Job>> = Mutex::new(None);
// Disk contents can change while a process still runs. Keep the first observed
// package version for that PID, and require a different PID after installation.
static RUNNING_VERSION: Mutex<Option<(u64, PathBuf, String)>> = Mutex::new(None);
fn observed_version(pid: Option<u64>, path: &Path) -> Option<String> {
    let pid = pid?;
    let mut cache = RUNNING_VERSION.lock().unwrap();
    if let Some((cached_pid, cached_path, version)) = cache.as_ref() {
        if *cached_pid == pid && cached_path == path {
            return Some(version.clone());
        }
    }
    let version = package_version(path)?;
    *cache = Some((pid, path.to_path_buf(), version.clone()));
    Some(version)
}
pub(crate) fn running_version() -> Option<String> {
    let owner = dsh::port_owner_info()?;
    let path = package_path(owner["cmd"].as_str()?)?;
    observed_version(owner["pid"].as_u64(), &path)
}
pub fn status() -> Option<Job> {
    JOB.lock().unwrap().clone().map(|mut j| {
        if let Some(started) = j.phase_started { j.elapsed_seconds = started.elapsed().as_secs(); }
        j
    })
}
pub fn busy() -> bool {
    status().is_some_and(|j| !matches!(j.phase.as_str(), "succeeded" | "failed"))
}

fn phase(app: &AppHandle, name: &str, error: Option<String>) {
    let snapshot = {
        let mut state = JOB.lock().unwrap();
        if let Some(j) = state.as_mut() {
            if name == "failed" && j.failed_phase.is_none() { j.failed_phase = Some(j.phase.clone()); }
            if let Some(started) = j.phase_started { j.elapsed_seconds = started.elapsed().as_secs(); }
            j.phase_started = if matches!(name, "failed" | "succeeded") { None } else { Some(Instant::now()) };
            if j.phase_started.is_some() { j.elapsed_seconds = 0; }
            j.budget_seconds = match name { "checking" => Some(90), "installing" => Some(600), _ => None };
            j.phase = name.into();
            j.error = error;
        }
        state.clone()
    };
    let _ = app.emit("dsh-backend-update", snapshot);
}

// Tokens preserve quoted Windows paths, including spaces and non-ASCII names.
fn package_path(command: &str) -> Option<PathBuf> {
    let mut quoted = false;
    let mut token = String::new();
    let mut tokens = Vec::new();
    for ch in command.chars().chain(std::iter::once(' ')) {
        if ch == '"' {
            quoted = !quoted;
        } else if ch.is_whitespace() && !quoted {
            if !token.is_empty() {
                tokens.push(std::mem::take(&mut token));
            }
        } else {
            token.push(ch);
        }
    }
    tokens.into_iter().find_map(|token| {
        let normalized = token.replace('\\', "/");
        let marker = "/node_modules/@deepseek-ai/dsh/";
        let at = normalized.to_ascii_lowercase().rfind(marker)?;
        let path = PathBuf::from(&normalized[..at + marker.len() - 1]);
        path.is_absolute().then_some(path)
    })
}

fn normalized(path: &Path) -> Option<String> {
    Some(
        std::fs::canonicalize(path)
            .ok()?
            .to_string_lossy()
            .trim_start_matches("\\\\?\\")
            .replace('\\', "/")
            .to_lowercase(),
    )
}
fn same_path(a: &Path, b: &Path) -> bool {
    match (normalized(a), normalized(b)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}
fn package_version(path: &Path) -> Option<String> {
    let doc: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path.join("package.json")).ok()?).ok()?;
    if doc["name"] != "@deepseek-ai/dsh" {
        return None;
    }
    doc["version"].as_str().map(str::to_owned)
}

fn npm_tools() -> Result<(PathBuf, PathBuf), String> {
    let node = PathBuf::from(dsh::where_first("node").ok_or("Node.js not found")?);
    let npm = PathBuf::from(dsh::where_first("npm").ok_or("npm not found")?);
    let cli = npm
        .parent()
        .ok_or("Cannot locate npm directory")?
        .join("node_modules/npm/bin/npm-cli.js");
    if !cli.is_file() {
        return Err("Cannot verify the npm CLI installation".into());
    }
    Ok((node, cli))
}

// Direct node + npm-cli arguments: no user-selected version enters a shell.
fn npm_run(args: &[&str], timeout: Duration) -> Result<String, String> {
    let (node, cli) = npm_tools()?;
    let mut command = Command::new(node);
    command.arg(cli).args(args).args(["--update-notifier=false", "--loglevel=http"]);
    crate::npm_operation::run(&mut command, timeout, args.first().copied().unwrap_or("unknown"))
}

pub fn source() -> Source {
    let owner = dsh::port_owner_info();
    let path = owner
        .as_ref()
        .and_then(|o| o["cmd"].as_str())
        .and_then(package_path);
    let pid = owner.as_ref().and_then(|o| o["pid"].as_u64());
    let mut result = Source {
        kind: "unknown".into(),
        pid,
        path: path.as_ref().map(|p| p.display().to_string()),
        version: path.as_deref().and_then(|p| observed_version(pid, p)),
        ..Default::default()
    };
    let custom = std::env::var("DSH_CMD").is_ok_and(|s| !s.trim().is_empty())
        || dsh::custom_dsh_path().is_some();
    let Some(path) = path else {
        if custom {
            result.kind = "custom".into();
        }
        return result;
    };
    let text = path.to_string_lossy().replace('\\', "/").to_lowercase();
    result.kind = if text.contains("/_npx/") {
        "npx"
    } else {
        "local"
    }
    .into();
    let Ok(prefix) = npm_run(&["prefix", "-g"], Duration::from_secs(15)) else {
        return result;
    };
    let root = Path::new(&prefix).join("node_modules/@deepseek-ai/dsh");
    if !same_path(&path, &root) {
        return result;
    }
    result.kind = "global".into();
    result.prefix = Some(prefix.clone());
    // A custom command may take precedence after restart. Never silently update another source.
    if custom {
        result.kind = "custom".into();
        return result;
    }
    let owned = owner.as_ref().and_then(|o| o["owned"].as_bool()) == Some(true);
    if !owned {
        result.kind = "external".into();
    }
    let shim = dsh::where_first("dsh").map(PathBuf::from);
    result.managed = result.version.is_some()
        && shim
            .as_ref()
            .and_then(|p| p.parent())
            .is_some_and(|p| same_path(p, Path::new(&prefix)));
    result
}

fn validate_target(current: &str, target: &str, allow_downgrade: bool) -> Result<(), String> {
    let current = semver::Version::parse(current).map_err(|_| "Unknown running version")?;
    let target = semver::Version::parse(target).map_err(|_| "Invalid target version")?;
    match target.cmp_precedence(&current) {
        std::cmp::Ordering::Equal => Err("Already running this version".into()),
        std::cmp::Ordering::Less if !allow_downgrade => {
            Err("Downgrade requires explicit confirmation".into())
        }
        _ => Ok(()),
    }
}

// External instances need explicit consent tied to the process the user saw.
fn authorized_source(source: &Source, expected_pid: u64, allow_external: bool) -> bool {
    source.managed && expected_pid > 0 && source.pid == Some(expected_pid)
        && (source.kind == "global" || (source.kind == "external" && allow_external))
}

fn verified_restart(before: &Source, after: &Source, target: &str, ready: bool) -> bool {
    ready
        && after.pid.is_some()
        && after.pid != before.pid
        && after.path == before.path
        && after.version.as_deref() == Some(target)
}

pub fn start(
    app: AppHandle,
    target: String,
    expected_path: String,
    expected_version: String,
    allow_downgrade: bool,
    expected_pid: u64,
    allow_external: bool,
) -> Result<Job, String> {
    // Parse even before creating a task; tags and command fragments are not accepted.
    semver::Version::parse(&target).map_err(|_| "Invalid target version")?;
    let job = Job {
        id: uuid::Uuid::new_v4().to_string(),
        phase: "checking".into(),
        target: target.clone(),
        error: None,
        failed_phase: None,
        installation_started: false,
        elapsed_seconds: 0,
        budget_seconds: Some(90),
        phase_started: Some(Instant::now()),
    };
    {
        let mut state = JOB.lock().unwrap();
        if state
            .as_ref()
            .is_some_and(|j| !matches!(j.phase.as_str(), "succeeded" | "failed"))
        {
            return Err("An update is already running".into());
        }
        *state = Some(job.clone());
    }
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            perform(
                &app,
                &target,
                &expected_path,
                &expected_version,
                allow_downgrade,
                expected_pid,
                allow_external,
            )
        }));
        match result {
            Ok(Ok(())) => phase(&app, "succeeded", None),
            other => {
                let error = match other {
                    Ok(Err(e)) => e,
                    _ => "Unexpected update failure".into(),
                };
                dsh::log_write(dsh::LogLevel::Error, &format!("[backend update] {error}"));
                phase(&app, "failed", Some(error));
            }
        }
    });
    Ok(job)
}

fn perform(
    app: &AppHandle,
    target: &str,
    expected_path: &str,
    expected_version: &str,
    allow_downgrade: bool,
    expected_pid: u64,
    allow_external: bool,
) -> Result<(), String> {
    let before = source();
    if !authorized_source(&before, expected_pid, allow_external)
        || before
            .path
            .as_deref()
            .is_none_or(|p| !same_path(Path::new(p), Path::new(expected_path)))
        || before.version.as_deref() != Some(expected_version)
    {
        return Err(
            "Installation changed or is not managed. Refresh the source before updating.".into(),
        );
    }
    validate_target(expected_version, target, allow_downgrade)?;
    if package_version(Path::new(expected_path)).as_deref() != Some(expected_version) {
        return Err(
            "The installed files changed while DSH was running. Restart and check again.".into(),
        );
    }
    // Confirm the exact package exists before stopping the working backend.
    let spec = format!("@deepseek-ai/dsh@{target}");
    let mut query_args = vec!["view", &spec, "version", "--registry=https://registry.npmjs.org"];
    query_args.extend_from_slice(crate::npm_operation::QUERY_FLAGS);
    let available = npm_run(&query_args, crate::npm_operation::QUERY_TIMEOUT)?;
    if available != target {
        return Err("Registry did not confirm the selected version".into());
    }
    let again = source();
    if !again.managed
        || again.pid != before.pid
        || again.path != before.path
        || again.version != before.version
        || again.kind != before.kind
        || again.prefix != before.prefix
    {
        return Err("Running instance changed; refresh and try again".into());
    }
    dsh::save_previous_version(expected_version)?;
    phase(app, "installing", None);
    // Recheck the exact listener immediately before stopping it. Never kill
    // whatever happens to occupy the port after this process exits.
    if before.kind == "external" {
        let owner = dsh::port_owner_info().ok_or("Backend disappeared; refresh and try again")?;
        let live_path = owner["cmd"].as_str().and_then(package_path);
        if owner["pid"].as_u64() != before.pid
            || live_path.as_deref().is_none_or(|p| !same_path(p, Path::new(expected_path))) {
            return Err("Running instance changed; installation was not started".into());
        }
        dsh::kill_tree(u32::try_from(expected_pid).map_err(|_| "Invalid backend PID")?);
    } else {
        dsh::teardown(app);
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    while dsh::port_listener_pid().is_some() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(250));
    }
    if dsh::port_listener_pid().is_some() {
        return Err("The backend port is still occupied; installation was not started".into());
    }
    let prefix = before.prefix.as_deref().ok_or("Missing npm prefix")?;
    if let Some(j) = JOB.lock().unwrap().as_mut() { j.installation_started = true; }
    let installed = npm_run(
        &[
            "install",
            "-g",
            "--prefix",
            prefix,
            &spec,
            "--registry=https://registry.npmjs.org",
        ],
        Duration::from_secs(600),
    );
    if installed.is_err() {
        if let Some(j) = JOB.lock().unwrap().as_mut() { j.failed_phase = Some("installing".into()); }
    }
    phase(app, "restarting", None);
    dsh::startup(app.clone());
    installed?;
    phase(app, "verifying", None);
    let after = source();
    if !verified_restart(&before, &after, target, dsh::probe_ready_once()) {
        return Err("Installation finished, but the requested running version could not be verified. Check logs; rollback is available if startup failed.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_update_requires_consent_and_same_process() {
        let mut source = Source { kind: "external".into(), managed: true, pid: Some(42), ..Default::default() };
        assert!(!authorized_source(&source, 42, false));
        assert!(authorized_source(&source, 42, true));
        assert!(!authorized_source(&source, 43, true));
        source.managed = false;
        assert!(!authorized_source(&source, 42, true));
        source.managed = true;
        source.kind = "custom".into();
        assert!(!authorized_source(&source, 42, true));
        source.kind = "global".into();
        assert!(authorized_source(&source, 42, false));
    }
    #[test]
    fn rc_order_and_downgrade_gate() {
        assert!(validate_target("0.1.5-rc.2", "0.1.5-rc.1", false).is_err());
        assert!(validate_target("0.1.5-rc.2", "0.1.5-rc.1", true).is_ok());
        assert!(validate_target("0.1.5-rc.2", "0.1.5-rc.10", false).is_ok());
        assert!(validate_target("0.1.5-rc.2", "0.1.5", false).is_ok());
        assert!(validate_target("0.1.5+one", "0.1.5+two", false).is_err());
        assert!(validate_target("0.1.5", "latest & calc", false).is_err());
    }
    #[test]
    fn quoted_absolute_package_path() {
        let path = package_path(r#""C:\Program Files\nodejs\node.exe" "C:\Users\小鱼\My Tools\node_modules\@deepseek-ai\dsh\lib\index.js" web"#).unwrap();
        assert_eq!(
            path,
            PathBuf::from("C:/Users/小鱼/My Tools/node_modules/@deepseek-ai/dsh")
        );
        assert!(package_path("node node_modules/@deepseek-ai/dsh/lib/index.js web").is_none());
        assert!(package_path("node C:/repo/source/cli.js web").is_none());
    }
    #[test]
    fn completion_requires_new_process_same_source_and_target() {
        let before = Source {
            pid: Some(10),
            path: Some("C:/npm/dsh".into()),
            version: Some("0.1.5-rc.1".into()),
            ..Default::default()
        };
        let mut after = Source {
            pid: Some(11),
            version: Some("0.1.5-rc.2".into()),
            ..before.clone()
        };
        assert!(verified_restart(&before, &after, "0.1.5-rc.2", true));
        assert!(!verified_restart(&before, &after, "0.1.5-rc.2", false));
        after.pid = before.pid;
        assert!(!verified_restart(&before, &after, "0.1.5-rc.2", true));
        after.pid = Some(11);
        after.path = Some("C:/another/dsh".into());
        assert!(!verified_restart(&before, &after, "0.1.5-rc.2", true));
        after.path = before.path.clone();
        after.version = before.version.clone();
        assert!(!verified_restart(&before, &after, "0.1.5-rc.2", true));
    }
    #[test]
    #[ignore = "Read-only inspection of the host installation"]
    fn inspect_host_source() {
        println!("{}", serde_json::to_string(&source()).unwrap());
    }
}
