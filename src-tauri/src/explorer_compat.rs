//! Narrow compatibility shim for DSH's hidden Windows Explorer launches.
//! No upstream package edits and no machine-wide environment changes.
use std::{io, process::Command};
use sha2::{Digest, Sha256};
const PRELOAD: &str = include_str!("explorer-visibility.cjs");

pub(crate) fn configure(command: &mut Command) -> io::Result<()> {
    if !cfg!(windows) { return Ok(()); }
    let root = dirs::data_local_dir().ok_or_else(|| io::Error::other("Local app data unavailable"))?
        .join("dsh-desktop").join("compat");
    std::fs::create_dir_all(&root)?;
    let digest = format!("{:x}", Sha256::digest(PRELOAD.as_bytes()));
    let file = root.join(format!("explorer-visibility-{}.cjs", &digest[..16]));
    if std::fs::read_to_string(&file).ok().as_deref() != Some(PRELOAD) {
        std::fs::write(&file, PRELOAD)?;
    }
    let existing = std::env::var("NODE_OPTIONS").unwrap_or_default();
    let path = file.to_string_lossy().replace('\\', "/");
    command.env("NODE_OPTIONS", format!("{existing} --require=\"{path}\""));
    Ok(())
}
