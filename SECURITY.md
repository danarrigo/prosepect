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

## Dependency security

There are no accepted npm or Rust advisory exceptions. All dependency advisories and Rust audit warnings are release-blocking.

Google sign-in uses `oauth2` for authorization-code exchange and PKCE, and `jsonwebtoken` with its AWS-LC backend for RS256 verification. The previous `openidconnect` dependency pulled in affected `crypto-bigint` and `rsa` versions. Removing that dependency removes both RUSTSEC-2026-0387 and the former RUSTSEC-2023-0071 exception, rather than suppressing either warning. See `docs/GOOGLE-SIGN-IN-VERIFICATION.md` for validation boundaries and tests.

## Automated dependency gates

`.github/workflows/security.yml` audits both committed lockfiles on pushes to `main`, pull requests, manual runs, and a daily best-effort schedule so newly published advisories are checked without code changes. No production credentials or issue creation permissions are used.

- Rust runs only on GitHub-hosted CI using `cargo-audit`. An unfiltered JSON artifact records every advisory. The **mandatory subsequent gate** denies every advisory and warning (including unmaintained/unsound/yanked findings), without ignores. `rust-dependency-audit` retains both the full report and the acceptance-gate log for 14 days. A diagnostic step marked allowed-to-fail does not waive the mandatory gate.
- npm audits the complete lockfile, including development dependencies, at `--audit-level=low`. There are no npm exceptions. `npm-dependency-audit` retains the JSON report for 14 days, including failures.

Require both audit jobs in repository merge rules and enable failure notifications. Workflow definitions alone do not configure branch protection or verify notification delivery. Network/database/tooling failures must be investigated, not treated as a clean security result. Schedules are not guaranteed to run on time; run the workflow manually against the release commit before publication.
