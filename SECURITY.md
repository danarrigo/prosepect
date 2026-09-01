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

`cargo audit` currently reports `RUSTSEC-2023-0071` for `rsa 0.9.10`, inherited only through `openidconnect 4.0.1`. No fixed upstream release is available. Prosepect uses this dependency to verify Google-signed OpenID Connect tokens and does not perform RSA private-key operations, which are the operation class affected by the timing advisory. The project therefore accepts this advisory temporarily, monitors the upstream dependency, and will upgrade when a patched compatible release exists.

All other npm and Rust dependency advisories remain release-blocking unless they are documented here with equivalent scope and mitigation.
