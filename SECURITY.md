# Security policy

## Supported versions

Security fixes are applied to the latest release on `main`. Prosepect has not yet committed to support windows for older releases.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Contact the repository owner privately with:

- the affected version or commit;
- reproduction steps;
- expected impact;
- any suggested mitigation.

Do not include real OAuth tokens, session cookies, personal content, or production database records. Reports will be acknowledged as soon as practical, validated privately, and disclosed after a fix or mitigation is available.

## Dependency advisory exception

### RUSTSEC-2023-0071: temporary, verification-only exception

Reviewed against public upstream metadata on 2026-09-11:

- [RustSec advisory](https://rustsec.org/advisories/RUSTSEC-2023-0071.html) ([source](https://github.com/RustSec/advisory-db/blob/main/crates/rsa/RUSTSEC-2023-0071.md)) still declares `patched = []`. The Marvin timing attack can disclose an RSA **private key**. [Upstream tracking](https://github.com/RustCrypto/RSA/issues/626) is not proof of a released fix.
- `Cargo.lock` contains `rsa 0.9.10`, with only `openidconnect 4.0.1` depending on it. The authoritative crates.io index still lists these as the latest stable versions ([rsa](https://github.com/rust-lang/crates.io-index/blob/master/3/r/rsa), [openidconnect](https://github.com/rust-lang/crates.io-index/blob/master/op/en/openidconnect)). RSA `0.10.0-rc.18` exists, but is a prerelease and is not declared patched by RustSec. No speculative upgrade is proposed.
- `apps/api/src/google_auth.rs::complete_login` uses `id_token_verifier`, verified claims with a nonce, and the access-token hash. The pinned [openidconnect verification implementation](https://github.com/ramosbugs/openidconnect-rs/blob/4.0.1/src/core/crypto.rs) constructs `rsa::RsaPublicKey` from the provider's public modulus/exponent and calls `verify`. Prosepect does not construct RSA private signing keys, sign RSA tokens, or decrypt using RSA. Stored OAuth credentials use AES-256-GCM, not RSA. The upstream library includes private-key APIs, but this app does not call them.

The repository owner temporarily accepts **only this advisory for this verification-only dependency path**, not the safety of RSA private-key operations or the absence of other vulnerabilities. Reassess before each public release, when this path or its versions change, or when RustSec/upstream publishes a fix. Adding RSA signing/decryption invalidates the exception; a compatible declared fix should replace it and remove the CI ignore.

All other npm and Rust dependency advisories remain release-blocking. Do not add ignores without equivalent reviewed scope and mitigation.

## Automated dependency gates

`.github/workflows/security.yml` audits both committed lockfiles on pushes to `main`, pull requests, manual runs, and a daily best-effort schedule so newly published advisories are checked without code changes. No production credentials or issue creation permissions are used.

- Rust runs only on GitHub-hosted CI using `cargo-audit`. The unfiltered JSON artifact deliberately includes the accepted advisory and may report a failure. The **mandatory subsequent gate** first rejects any change to the reviewed RSA version or direct dependency path, ignores only `RUSTSEC-2023-0071`, denies warnings (including unmaintained/unsound/yanked findings), and fails on other advisories or audit errors. `rust-dependency-audit` retains both the full report and the acceptance-gate log for 14 days. A diagnostic step marked allowed-to-fail does not waive the mandatory gate.
- npm audits the complete lockfile, including development dependencies, at `--audit-level=low`. There are no npm exceptions. `npm-dependency-audit` retains the JSON report for 14 days, including failures.

Require both audit jobs in repository merge rules and enable failure notifications. Workflow definitions alone do not configure branch protection or verify notification delivery. Network/database/tooling failures must be investigated, not treated as a clean security result. Schedules are not guaranteed to run on time; run the workflow manually against the release commit before publication.
