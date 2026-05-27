use log::warn;
use tauri::AppHandle;

/// Result returned to the frontend from `check_update_version`.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    /// Whether the remote version is strictly newer than the installed version.
    pub should_update: bool,
    /// Human-readable reason when should_update is false.
    pub reason: Option<String>,
}

/// Auxiliary IPC command that enforces the downgrade-protection layer
/// described in ADR-0005 §Downgrade Attack Protection.
///
/// tauri-plugin-updater already rejects downgrades by default
/// (allowDowngrades defaults to false on the JS side), but this Rust-side
/// guard provides a second layer: it compares the supplied remote_version
/// against the current application version and returns false with a WARN log
/// if the remote version is not strictly greater.
///
/// The frontend is responsible for calling this before showing the install
/// confirmation dialog; it should silently discard updates where
/// `should_update == false`.
#[tauri::command]
pub fn check_update_version(
    app: AppHandle,
    remote_version: String,
) -> Result<UpdateCheckResult, String> {
    let current_str = app.package_info().version.to_string();

    let current = parse_semver(&current_str)
        .map_err(|e| format!("failed to parse current version '{}': {}", current_str, e))?;
    let remote = parse_semver(&remote_version)
        .map_err(|e| format!("failed to parse remote version '{}': {}", remote_version, e))?;

    if remote <= current {
        warn!(
            "[updater] downgrade/same-version detected: remote={} <= installed={}, ignoring update",
            remote_version, current_str
        );
        return Ok(UpdateCheckResult {
            should_update: false,
            reason: Some(format!(
                "remote version {} is not newer than installed {}",
                remote_version, current_str
            )),
        });
    }

    Ok(UpdateCheckResult {
        should_update: true,
        reason: None,
    })
}

/// Minimal semver parser: parses "MAJOR.MINOR.PATCH" into a comparable tuple.
/// Pre-release / build metadata suffixes are stripped (treated as release).
fn parse_semver(version: &str) -> Result<(u64, u64, u64), String> {
    // Strip optional leading 'v'
    let v = version.trim_start_matches('v');
    // Strip pre-release / build metadata
    let base = v.split(['-', '+']).next().unwrap_or(v);
    let parts: Vec<&str> = base.splitn(3, '.').collect();
    if parts.len() != 3 {
        return Err(format!("expected MAJOR.MINOR.PATCH, got '{}'", version));
    }
    let major = parts[0]
        .parse::<u64>()
        .map_err(|_| format!("invalid major in '{}'", version))?;
    let minor = parts[1]
        .parse::<u64>()
        .map_err(|_| format!("invalid minor in '{}'", version))?;
    let patch = parts[2]
        .parse::<u64>()
        .map_err(|_| format!("invalid patch in '{}'", version))?;
    Ok((major, minor, patch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_semver_basic() {
        assert_eq!(parse_semver("1.2.3").unwrap(), (1, 2, 3));
        assert_eq!(parse_semver("v1.2.3").unwrap(), (1, 2, 3));
        assert_eq!(parse_semver("0.1.0").unwrap(), (0, 1, 0));
    }

    #[test]
    fn parse_semver_strips_prerelease() {
        assert_eq!(parse_semver("1.2.3-alpha.1").unwrap(), (1, 2, 3));
        assert_eq!(parse_semver("1.2.3+build.42").unwrap(), (1, 2, 3));
    }

    #[test]
    fn parse_semver_invalid() {
        assert!(parse_semver("1.2").is_err());
        assert!(parse_semver("not.a.version").is_err());
    }

    #[test]
    fn downgrade_detected() {
        let current = (1, 2, 0);
        let remote = (1, 1, 9);
        assert!(remote <= current);
    }

    #[test]
    fn same_version_detected() {
        let current = (0, 1, 0);
        let remote = (0, 1, 0);
        assert!(remote <= current);
    }

    #[test]
    fn upgrade_allowed() {
        let current = (0, 1, 0);
        let remote = (0, 1, 1);
        assert!(remote > current);
    }
}
