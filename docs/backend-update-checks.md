# DSH backend update behavior

The desktop shell and DSH backend have independent version lines.
Backend channels are npm dist-tags (`latest`, `next`, advanced `alpha`), not
guarantees of stable releases or monotonically increasing versions.

- Compare complete SemVer precedence, including prerelease identifiers.
- Display the selected tag's version. Missing tags and network failures never
  fall back to another tag or enable installation.
- A verified npm global installation can be updated in place, including an
  externally started instance after explicit confirmation.
  Resolve the running process's package path and npm prefix; reject custom,
  local, npx, unknown or changed sources for one-click installation.
- Copying a command does not execute it. Commands use explicit versions.
- Rust rechecks source/version, validates the target in the registry and rejects
  unconfirmed downgrades before stopping the selected process.
- External updates require explicit consent and the PID shown at confirmation.
  Recheck the live listener and package path immediately before stopping only
  that process tree. Never clear a replacement listener; an occupied port aborts
  installation. Pause external auto-restart supervisors before updating.
- A Rust task holds checking/installing/restarting/verifying/terminal state.
  Page changes and WebView reloads recover the task via its status command.
- Success requires a ready backend, a new PID, the same package path and the
  requested package version. An npm success exit code alone is insufficient.

## Checks

```powershell
pnpm test:backend-update
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml --release --lib --features custom-protocol
pnpm tauri build
```

The ignored `backend_update::tests::inspect_host_source` test is a read-only
host diagnostic. Normal tests never install or downgrade DSH. Browser checks
use mocked Tauri commands to cover channel changes, copy-only behavior, pinned
installation, downgrade confirmation, task recovery, failure states and narrow
windows. A real package upgrade is not part of routine UI verification.

## Local delivery preference

After completed software changes pass checks, build the desktop executable and
sync it to `%LOCALAPPDATA%\Programs\dsh-desktop-windowos`.
Stage and hash-check the executable, retain a timestamped backup of the current
installation, replace the executable, and verify the final hash. Do not force
close a running desktop instance; the user can exit from the tray and reopen.
This local delivery preference does not authorize npm or GitHub publication.

## v1.6.66 verification

28 Rust tests passed (4 opt-in tests ignored). Six backend model tests passed.
Browser mocks cover external update availability, confirmation cancellation,
PID/consent forwarding, and custom-source rejection, alongside existing update
progress and retry checks. Production build and embedded assets verified.
No live global npm update or termination of the user backend was performed.
