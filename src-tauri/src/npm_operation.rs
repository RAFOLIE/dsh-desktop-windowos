//! Bounded process capture. Diagnostics expose only recognized npm error codes,
//! never arbitrary stderr (which may contain credentials or private paths).
use std::{io::Read, process::{Command, Stdio}, sync::{Arc, Mutex}, time::{Duration, Instant}};

pub const QUERY_TIMEOUT: Duration = Duration::from_secs(90);
pub const QUERY_FLAGS: &[&str] = &[
    "--fetch-timeout=20000", "--fetch-retries=2", "--fetch-retry-factor=1",
    "--fetch-retry-mintimeout=2000", "--fetch-retry-maxtimeout=2000",
    "--update-notifier=false", "--loglevel=http",
];
const CODES: &[&str] = &["ECONNRESET", "ETIMEDOUT", "ESOCKETTIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "E404", "ETARGET", "E401", "E403", "E429", "E500", "E502", "E503", "E504", "EACCES", "EPERM", "ENOSPC", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN"];
const LIMIT: usize = 64 * 1024;
#[derive(Default)]
struct Capture { bytes: Vec<u8>, codes: Vec<&'static str> }
impl Capture {
    fn append(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
        let text = String::from_utf8_lossy(&self.bytes);
        for code in CODES {
            if text.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|word| word == *code) && !self.codes.contains(code) {
                self.codes.push(code);
            }
        }
        if self.bytes.len() > LIMIT { self.bytes.drain(..self.bytes.len() - LIMIT); }
    }
}
fn drain(mut stream: impl Read + Send + 'static) -> (Arc<Mutex<Capture>>, std::sync::mpsc::Receiver<()>) {
    let capture = Arc::new(Mutex::new(Capture::default()));
    let copy = capture.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = [0; 4096];
        while let Ok(n) = stream.read(&mut bytes) {
            if n == 0 { break; }
            copy.lock().unwrap().append(&bytes[..n]);
        }
        let _ = tx.send(());
    });
    (capture, rx)
}
pub fn run(command: &mut Command, timeout: Duration, operation: &str) -> Result<String, String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let started = Instant::now();
    let mut child = command.spawn().map_err(|_| "npm: SPAWN_FAILED".to_string())?;
    let (output, out_done) = drain(child.stdout.take().unwrap());
    let (errors, err_done) = drain(child.stderr.take().unwrap());
    let (status, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(status)) => break (Some(status), false),
            Ok(None) if started.elapsed() < timeout => std::thread::sleep(Duration::from_millis(50)),
            other => {
                crate::dsh::kill_tree(child.id());
                let _ = child.wait();
                break (None, other.is_ok());
            }
        }
    };
    // A descendant may retain a pipe. Never join a reader indefinitely.
    let _ = out_done.recv_timeout(Duration::from_millis(500));
    let _ = err_done.recv_timeout(Duration::from_millis(500));
    let errors = errors.lock().unwrap();
    let codes = errors.codes.join(", ");
    let exit = status.and_then(|s| s.code()).map(|n| n.to_string()).unwrap_or_else(|| "none".into());
    crate::dsh::log_write(crate::dsh::LogLevel::Info, &format!("[backend update] npm {operation}: elapsed={}s exit={exit} timeout={timed_out} codes=[{codes}]", started.elapsed().as_secs()));
    if status.is_some_and(|s| s.success()) {
        return Ok(String::from_utf8_lossy(&output.lock().unwrap().bytes).trim().to_owned());
    }
    let reason = if timed_out { "TIMEOUT" } else { "FAILED" };
    Err(format!("npm: {reason}; exit={exit}; codes=[{codes}]"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_capture_retains_codes_without_exposing_secrets() {
        let mut capture = Capture::default();
        capture.append(b"https://user:secret@example.test/private ECONN");
        capture.append(b"RESET token=npm_secret E404");
        capture.append(&vec![b'x'; LIMIT + 20]);
        assert_eq!(capture.bytes.len(), LIMIT);
        assert_eq!(capture.codes, vec!["ECONNRESET", "E404"]);
    }
    #[test]
    fn query_retry_budget_fits_deadline() {
        assert!(Duration::from_secs(20 * 3 + 2 * 2 + 10) < QUERY_TIMEOUT);
    }
    #[test]
    fn process_timeout_preserves_error_code() {
        let mut cmd = Command::new("node");
        cmd.args(["-e", "process.stderr.write('ECONNRESET secret=do-not-log'); setInterval(()=>{},1000)"]);
        let started = Instant::now();
        let error = run(&mut cmd, Duration::from_secs(2), "test").unwrap_err();
        assert!(error.contains("TIMEOUT") && error.contains("ECONNRESET"));
        assert!(!error.contains("do-not-log"));
        assert!(started.elapsed() < Duration::from_secs(10));
    }
}
