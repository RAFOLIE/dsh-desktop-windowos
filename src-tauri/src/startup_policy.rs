//! Read-only launch policy. Never execute a CLI to discover its capabilities.
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

pub const INSTALLED_WINDOW: Duration = Duration::from_secs(120);
pub const NPX_WINDOW: Duration = Duration::from_secs(300);

#[derive(Debug, PartialEq, Eq)]
pub enum Capability {
    Supported,
    Unsupported,
    Unknown,
}

fn read_small(path: &Path) -> Option<String> {
    if fs::metadata(path).ok()?.len() > 2_000_000 {
        return None;
    }
    fs::read_to_string(path).ok()
}
fn package(root: &Path, name: &str) -> Option<Value> {
    let value: Value = serde_json::from_str(&read_small(&root.join("package.json"))?).ok()?;
    if value["name"] != name || semver::Version::parse(value["version"].as_str()?).is_err() {
        return None;
    }
    Some(value)
}

/// Only known npm/pnpm shim forms. An unrelated package beside a wrapper is
/// not proof that the wrapper launches that package. No session cache: package
/// replacement/upgrade is observed on the next launch, including same versions.
pub fn cli_root(shim: &Path) -> Option<PathBuf> {
    let source = read_small(shim)?.replace('\\', "/");
    let source = source
        .lines()
        .filter(|line| {
            let trimmed = line
                .trim_start()
                .trim_start_matches('@')
                .to_ascii_lowercase();
            !["rem ", "::", "#", "echo "]
                .iter()
                .any(|prefix| trimmed.starts_with(prefix))
                && (line.contains("%*") || line.contains("\"$@\"") || line.contains("$args"))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let base = shim.parent()?;
    for prefix in ["%dp0%/", "%~dp0/", "$basedir/", "${basedir}/"] {
        for (_, rest) in source
            .match_indices(prefix)
            .map(|(i, _)| (i, &source[i + prefix.len()..]))
        {
            let relative = rest.split(['"', '\'', '\r', '\n']).next()?;
            if !relative.ends_with("/@deepseek-ai/dsh/lib/bin.js") {
                continue;
            }
            let entry = fs::canonicalize(base.join(relative)).ok()?;
            let root = entry.parent()?.parent()?;
            let doc = package(root, "@deepseek-ai/dsh")?;
            if doc["bin"]["dsh"]
                .as_str()
                .map(|s| s.trim_start_matches("./"))
                == Some("lib/bin.js")
            {
                return Some(root.to_path_buf());
            }
        }
    }
    None
}

pub fn no_open(shim: &Path) -> Capability {
    let Some(root) = cli_root(shim) else {
        return Capability::Unknown;
    };
    // Node resolution from the real package directory also covers pnpm's
    // symlinked virtual store and hoisted npm dependencies.
    for parent in root.ancestors() {
        let web = parent.join("node_modules/@deepseek-ai/dsh-web-app");
        if !web.exists() {
            continue;
        }
        let Some(doc) = package(&web, "@deepseek-ai/dsh-web-app") else {
            return Capability::Unknown;
        };
        let Some(entry) = doc["exports"]["./startup"]["default"].as_str() else {
            return Capability::Unknown;
        };
        if entry != "./lib/startup.js" {
            return Capability::Unknown;
        }
        let Some(source) = read_small(&web.join(entry)) else {
            return Capability::Unknown;
        };
        return source_capability(&source);
    }
    Capability::Unknown
}

fn source_capability(source: &str) -> Capability {
    // Inspect the verified command declaration, never prose mentioning a flag.
    let Some(body) = source
        .split("function webCommand() {")
        .nth(1)
        .and_then(|s| s.split_once("\n}").map(|p| p.0))
    else {
        return Capability::Unknown;
    };
    let compact: String = body.chars().filter(|c| !c.is_whitespace()).collect();
    if !compact.contains("newCommand()") {
        return Capability::Unknown;
    }
    if compact.contains(".option(\"--no-open\",") || compact.contains(".option('--no-open',") {
        Capability::Supported
    } else if compact.contains(".option(\"--port<port>\",")
        || compact.contains(".option('--port<port>',")
    {
        Capability::Unsupported
    } else {
        Capability::Unknown
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Poll {
    Ready,
    Exited,
    Timeout,
    Waiting,
}
pub fn poll(ready: bool, exited: bool, elapsed: Duration, budget: Duration) -> Poll {
    if ready {
        Poll::Ready
    } else if exited {
        Poll::Exited
    } else if elapsed >= budget {
        Poll::Timeout
    } else {
        Poll::Waiting
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum WebWait {
    Open,
    Failed,
    Timeout,
    Waiting,
}
pub fn web_wait(ready: bool, active: bool, terminal: bool, elapsed: Duration) -> WebWait {
    if ready && !active {
        WebWait::Open
    } else if terminal && !active {
        WebWait::Failed
    }
    // Covers the complete candidate/repair chain and a package update. A dead
    // lifecycle still cannot keep a browser request alive indefinitely.
    else if elapsed >= Duration::from_secs(2400) || (!active && elapsed >= INSTALLED_WINDOW) {
        WebWait::Timeout
    } else {
        WebWait::Waiting
    }
}

pub fn writer_lock_path(lines: &[String]) -> Option<String> {
    lines.iter().find_map(|line| {
        let path = line
            .split_once("timed out waiting for the writer lock at ")?
            .1
            .trim();
        let end = path.find(".lock")? + 5;
        let path = &path[..end];
        (!path.chars().any(char::is_control)).then(|| path.to_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cold_start_and_early_exit_have_different_deadlines() {
        for seconds in [30, 41, 60, 119] {
            let elapsed = Duration::from_secs(seconds);
            assert_eq!(poll(false, false, elapsed, INSTALLED_WINDOW), Poll::Waiting);
            assert_eq!(poll(true, false, elapsed, INSTALLED_WINDOW), Poll::Ready);
        }
        assert_eq!(
            poll(false, true, Duration::ZERO, INSTALLED_WINDOW),
            Poll::Exited
        );
        assert_eq!(
            poll(false, false, INSTALLED_WINDOW, INSTALLED_WINDOW),
            Poll::Timeout
        );
        assert_eq!(
            poll(false, false, Duration::from_secs(299), NPX_WINDOW),
            Poll::Waiting
        );
        assert_eq!(poll(false, false, NPX_WINDOW, NPX_WINDOW), Poll::Timeout);
    }
    #[test]
    fn browser_tracks_slow_start_update_failure_and_hard_cap() {
        for seconds in [119, 120, 299, 600] {
            assert_eq!(
                web_wait(false, true, false, Duration::from_secs(seconds)),
                WebWait::Waiting
            );
        }
        assert_eq!(
            web_wait(true, true, false, Duration::from_secs(200)),
            WebWait::Waiting
        );
        assert_eq!(
            web_wait(true, false, false, Duration::from_secs(200)),
            WebWait::Open
        );
        assert_eq!(
            web_wait(false, false, true, Duration::from_secs(5)),
            WebWait::Failed
        );
        assert_eq!(
            web_wait(false, false, false, INSTALLED_WINDOW),
            WebWait::Timeout
        );
        assert_eq!(
            web_wait(false, true, false, Duration::from_secs(2400)),
            WebWait::Timeout
        );
    }
    #[test]
    fn declarations_not_help_text_and_unknown_formats() {
        assert_eq!(source_capability("// --no-open"), Capability::Unknown);
        assert_eq!(
            source_capability(
                "function webCommand() {\nreturn new Command().option('--port <port>', 'port');\n}"
            ),
            Capability::Unsupported
        );
        assert_eq!(
            source_capability(
                "function webCommand() {\nreturn new Command().option('--no-open', 'disable');\n}"
            ),
            Capability::Supported
        );
    }
    #[test]
    fn shim_discovery_never_executes_and_rereads_upgrades() {
        let dir = std::env::temp_dir().join(format!("dsh-policy-{}", uuid::Uuid::new_v4()));
        let cli = dir.join("node_modules/@deepseek-ai/dsh");
        let web = cli.join("node_modules/@deepseek-ai/dsh-web-app");
        fs::create_dir_all(cli.join("lib")).unwrap();
        fs::create_dir_all(web.join("lib")).unwrap();
        fs::write(
            cli.join("lib/bin.js"),
            "throw new Error('must never execute')",
        )
        .unwrap();
        fs::write(
            cli.join("package.json"),
            r#"{"name":"@deepseek-ai/dsh","version":"0.1.5-rc.2","bin":{"dsh":"lib/bin.js"}}"#,
        )
        .unwrap();
        fs::write(web.join("package.json"), r#"{"name":"@deepseek-ai/dsh-web-app","version":"0.1.5-rc.2","exports":{"./startup":{"default":"./lib/startup.js"}}}"#).unwrap();
        let shim = dir.join("dsh.cmd");
        fs::write(
            &shim,
            "\"%dp0%/node_modules/@deepseek-ai/dsh/lib/bin.js\" %*",
        )
        .unwrap();
        for (declaration, expected) in [
            (".option('--no-open', 'disable')", Capability::Supported),
            (".option('--port <port>', 'port')", Capability::Unsupported),
        ] {
            fs::write(
                web.join("lib/startup.js"),
                format!("function webCommand() {{\nreturn new Command(){declaration};\n}}"),
            )
            .unwrap();
            assert_eq!(no_open(&shim), expected);
        }
        fs::write(&shim, "echo wrapper unrelated to neighboring package").unwrap();
        assert_eq!(no_open(&shim), Capability::Unknown);
        fs::write(
            &shim,
            "rem \"%dp0%/node_modules/@deepseek-ai/dsh/lib/bin.js\" %*\necho ignore",
        )
        .unwrap();
        assert_eq!(no_open(&shim), Capability::Unknown);
        // pnpm .bin uses a relative path to a symlinked package; canonicalize
        // the actual entry before resolving its dependencies.
        let bin = dir.join("node_modules/.bin");
        fs::create_dir_all(&bin).unwrap();
        let pnpm = bin.join("dsh.cmd");
        fs::write(&pnpm, "node \"%~dp0/../@deepseek-ai/dsh/lib/bin.js\" %*").unwrap();
        assert_eq!(cli_root(&pnpm), Some(fs::canonicalize(&cli).unwrap()));
        assert_eq!(no_open(&pnpm), Capability::Unsupported);
        // Missing source never falls back to executing a command or reading
        // the user's profile. Existing writer locks are byte-for-byte intact.
        let lock = dir.join("node_modules.lock");
        fs::write(&lock, std::process::id().to_string()).unwrap();
        fs::remove_file(web.join("lib/startup.js")).unwrap();
        assert_eq!(no_open(&pnpm), Capability::Unknown);
        assert_eq!(
            fs::read_to_string(&lock).unwrap(),
            std::process::id().to_string()
        );
        fs::remove_dir_all(&dir).unwrap();
    }
    #[test]
    #[ignore = "Read-only capability inspection of an explicitly selected installation"]
    fn inspect_installed_capability() {
        let shim = PathBuf::from(std::env::var("DSH_TEST_SHIM").expect("set DSH_TEST_SHIM"));
        assert!(cli_root(&shim).is_some());
        assert_eq!(no_open(&shim), Capability::Supported);
    }
    #[test]
    fn lock_error_extracts_only_reported_path() {
        assert_eq!(writer_lock_path(&[r"Error: atomic-write: timed out waiting for the writer lock at C:\Example User\.dsh\profiles\node_modules.lock".into()]), Some(r"C:\Example User\.dsh\profiles\node_modules.lock".into()));
        assert_eq!(writer_lock_path(&["network timed out".into()]), None);
    }
}
