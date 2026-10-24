# Google sign-in verification

Google authentication is Google-specific, not a configurable general OIDC client. Replacing `openidconnect` removes the affected RustCrypto RSA/EC dependency chain. `oauth2` handles code exchange, state generation and S256 PKCE; `jsonwebtoken` uses the AWS-LC cryptographic backend. Neither crypto-bigint nor rsa is retained and no advisory exception is needed.

## Trust boundaries

- Production authorization, token and signing-key endpoints are fixed Google HTTPS URLs. The HTTP client refuses redirects, has a 10-second connection deadline and a 30-second request deadline. No token-supplied key URLs or embedded keys are trusted.
- State remains checked and consumed by the existing callback/session flow. A separate random nonce and PKCE verifier are generated for each request. The verifier and exact redirect URI are sent in the authorization-code exchange. Calendar/Tasks incremental consent remains explicit and separate from sign-in.
- Each callback fetches a fresh Google JWKS, bounded to 1 MiB. This avoids stale-key caching during rotation. A provider outage fails closed; the one-use code exchange is not retried. At this app's scale, the extra key request is preferable to introducing cache invalidation complexity.
- Only RS256 is allowed, matching Google's documented ID-token algorithm. A nonempty key ID must identify exactly one compatible RSA signing/verification key in the trusted JWKS. Unsupported critical headers and unencoded payload extensions are rejected.
- JWT signature, exact HTTPS Google issuer, client audience, required expiration and subject are validated by jsonwebtoken. Not-before is checked when present. Expiration has no grace period.
- Additional OIDC checks require the original nonce, issued-at no more than 60 seconds in the future, nonempty subject (at most 255 bytes), nonempty verified email, and matching authorized party when supplied or required by multiple audiences. The RS256 access-token hash is checked when supplied. Nonce and hash comparisons use constant-time equality.
- Name/picture are optional profile data, not identity keys. Credentials are encrypted only after verification. Existing AES-GCM storage, refresh, revocation, invite-only admission, account-linking and legal acceptance rules remain unchanged.

## Verification

Tests sign real RS256 tokens with disposable public test fixtures. They cover accepted identity, optional claims, multi-audience authorized party, expiration, future issue/not-before times, missing/wrong claims, nonce/hash binding, unverified email, tampering, invalid signatures, algorithm confusion, untrusted header key locations, missing/unknown/ambiguous signing keys, key purpose and rotation. An offline HTTP exchange exercises OAuth client authentication, authorization code, PKCE verifier, redirect URI, real signature validation, scope retention and encrypted access/refresh credentials.

CI runs Rust compilation, tests, containers, frontend and real-backend browser suites remotely. These are not live Google consent/sign-in acceptance. No production tokens or writes are used.

## Primary references

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect): server flow, ID-token validation, nonce, at_hash, azp and Google endpoints.
- [OIDC Core, ID Token Validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation).
- [jsonwebtoken Validation](https://docs.rs/jsonwebtoken/11.1.0/jsonwebtoken/struct.Validation.html) and [crypto backends](https://docs.rs/jsonwebtoken/11.1.0/jsonwebtoken/).
- [oauth2 5.0](https://docs.rs/oauth2/5.0.0/oauth2/): redirect restrictions, authorization-code flow and PKCE.
- [RustSec crypto-bigint advisory](https://rustsec.org/advisories/RUSTSEC-2026-0387.html).
