# Release Setup Guide

This document describes the one-time setup steps required before the first
tagged release can be published.  See also ADR-0005 for the design rationale.

---

## 1. Key generation

Generate an Ed25519 signing key pair with Tauri's built-in signer tool.
Run the following command on a trusted machine (not in CI):

```sh
pnpm tauri signer generate -w ~/.tauri/choco.key
```

The command prints:

- **Public key** — a base64 string, printed to stdout.
- **Private key** — written to `~/.tauri/choco.key` (keep this file safe).

> **Security**: Never commit the private key file.  Back it up to a secure
> offline location (e.g. an encrypted USB drive in a physically secure place).

---

## 2. Embed the public key in tauri.conf.json

Open `src-tauri/tauri.conf.json` and replace the placeholder value:

```json
"plugins": {
  "updater": {
    "pubkey": "REPLACE_ME_AFTER_KEY_GEN"
  }
}
```

Paste the **public key** string printed by the signer command:

```json
"plugins": {
  "updater": {
    "pubkey": "<base64-encoded-ed25519-public-key>"
  }
}
```

Commit the updated `tauri.conf.json`.  The public key is baked into the
application binary; it is not a secret.

---

## 3. Register GitHub Actions secrets

In the **source** repository (`abroadcrew02-spec/choco`) go to:
**Settings > Secrets and variables > Actions > New repository secret**

| Secret name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The base64-encoded private key content from `~/.tauri/choco.key` (open the file in a text editor and copy the entire contents) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The passphrase you entered during key generation, or an empty string if you did not set one |
| `RELEASES_REPO_PAT` | A GitHub Personal Access Token (classic, `repo` scope) or Fine-grained PAT with **Contents: Read and Write** on the public mirror repository |

---

## 4. Create the public mirror repository

PLACEHOLDER: replace `abroadcrew02-spec/choco-releases` with the actual
organization/repository name in all locations listed in §6 below.

```sh
gh repo create abroadcrew02-spec/choco-releases --public \
  --description "Choco release artifacts (binaries only)"
```

Initialize the repository (GitHub requires at least one commit):

```sh
cd /tmp
git clone https://github.com/abroadcrew02-spec/choco-releases.git
cd choco-releases
echo "# choco-releases" > README.md
git add README.md
git commit -m "init"
git push
```

---

## 5. Update placeholder URLs

After creating the public mirror repository, update the following files
to replace `abroadcrew02-spec/choco-releases` with the actual repo name:

| File | Location |
|---|---|
| `src-tauri/tauri.conf.json` | `plugins.updater.endpoints[0]` |
| `.github/workflows/release.yml` | Step "Generate latest.json" `BASE_URL` and Step "Create release in public mirror repository" `repository:` |

---

## 6. Publish the first release

Tag a commit and push the tag to trigger the release workflow:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The GitHub Actions workflow `.github/workflows/release.yml` will:

1. Build the application for Windows.
2. Sign the installer with the Ed25519 private key from Secrets.
3. Generate `latest.json`.
4. Upload `.msi`, `.msi.sig`, and `latest.json` to a new release in the
   public mirror repository.

After the workflow completes, verify that
`https://github.com/abroadcrew02-spec/choco-releases/releases/latest/download/latest.json`
is accessible and contains the correct version and signature.

---

## 7. Key rotation

Key rotation is required if the private key is compromised or as part of a
planned major version release.

Steps:

1. Generate a new key pair (step 1 above).
2. Update `tauri.conf.json` with the new public key.
3. Update `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   secrets with the new values.
4. Tag and release a new version.

> **Note**: Clients running a version signed with the old key will fail
> signature verification against the new public key.  Those clients must
> be updated manually (install the new installer directly).
> Document this in release notes when a key rotation occurs.

---

## 8. GitHub service outage fallback

If GitHub is unavailable and an update cannot be delivered via the automatic
channel:

1. Build the installer locally: `pnpm tauri build`
2. Distribute the `.msi` file directly to affected users.
3. Users run the installer manually.

The application continues to function at the currently installed version
while the updater silently fails (ADR-0005 fallback: network errors are
not shown to the user).
