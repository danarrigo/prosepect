//! Google-only OIDC verification. OAuth code/PKCE handling remains in oauth2;
//! signature verification uses jsonwebtoken's AWS-LC backend, not RustCrypto RSA/EC.
use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use jsonwebtoken::{
    Algorithm, DecodingKey, Validation, decode, decode_header,
    jwk::{AlgorithmParameters, JwkSet, KeyAlgorithm, KeyOperations, PublicKeyUse},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

#[derive(Clone, Deserialize)]
pub(crate) struct GoogleClaims {
    pub sub: String,
    pub email: String,
    pub name: Option<String>,
    pub picture: Option<String>,
    email_verified: bool,
    nonce: String,
    aud: Audience,
    azp: Option<String>,
    iat: u64,
    exp: u64,
    at_hash: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(untagged)]
enum Audience {
    One(String),
    Many(Vec<String>),
}

pub(crate) fn verify_id_token(
    token: &str,
    jwks: &JwkSet,
    client_id: &str,
    nonce: &str,
    access_token: &str,
) -> Result<GoogleClaims> {
    if token.len() > 64 * 1024 || client_id.is_empty() || nonce.is_empty() {
        bail!("invalid Google ID token input");
    }
    let header = decode_header(token).context("invalid Google ID token header")?;
    // Google documents RS256. Never infer accepted algorithms from attacker input,
    // accept symmetric keys, or resolve jku/x5u/embedded keys from token headers.
    if header.alg != Algorithm::RS256
        || header
            .crit
            .as_ref()
            .is_some_and(|fields| !fields.is_empty())
        || header.extras.get::<serde_json::Value>("b64")?.is_some()
    {
        bail!("unsupported Google ID token header");
    }
    let kid = header
        .kid
        .filter(|kid| !kid.is_empty())
        .ok_or_else(|| anyhow::anyhow!("Google ID token has no signing key ID"))?;
    let mut candidates = jwks.keys.iter().filter(|key| {
        key.common.key_id.as_deref() == Some(kid.as_str())
            && matches!(key.algorithm, AlgorithmParameters::RSA(_))
            && key
                .common
                .key_algorithm
                .is_none_or(|alg| alg == KeyAlgorithm::RS256)
            && key
                .common
                .public_key_use
                .as_ref()
                .is_none_or(|usage| *usage == PublicKeyUse::Signature)
            && key
                .common
                .key_operations
                .as_ref()
                .is_none_or(|ops| ops.contains(&KeyOperations::Verify))
    });
    let key = candidates
        .next()
        .context("Google ID token signing key not found")?;
    if candidates.next().is_some() {
        bail!("ambiguous Google ID token signing key");
    }
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation.set_issuer(&["https://accounts.google.com"]);
    validation.set_audience(&[client_id]);
    validation.validate_nbf = true;
    // Preserve strict expiration, with bounded skew only for issued-at in the future.
    validation.leeway = 0;
    let claims = decode::<GoogleClaims>(token, &DecodingKey::from_jwk(key)?, &validation)
        .context("Google returned an invalid ID token")?
        .claims;
    let multiple_audiences = match &claims.aud {
        Audience::One(aud) => {
            if aud != client_id {
                bail!("Google ID token audience mismatch");
            }
            false
        }
        Audience::Many(aud) => aud.len() > 1,
    };
    if (multiple_audiences && claims.azp.is_none())
        || claims.azp.as_deref().is_some_and(|azp| azp != client_id)
    {
        bail!("Google ID token authorized party mismatch");
    }
    if claims.sub.is_empty()
        || claims.sub.len() > 255
        || !claims.sub.is_ascii()
        || claims.email.trim().is_empty()
        || !claims.email_verified
        || claims.exp <= jsonwebtoken::get_current_timestamp()
        || claims.iat > jsonwebtoken::get_current_timestamp().saturating_add(60)
    {
        bail!("Google ID token identity or issued-at is invalid");
    }
    if !bool::from(claims.nonce.as_bytes().ct_eq(nonce.as_bytes())) {
        bail!("Google ID token nonce mismatch");
    }
    if let Some(expected) = &claims.at_hash {
        let digest = Sha256::digest(access_token.as_bytes());
        let actual = URL_SAFE_NO_PAD.encode(&digest[..16]);
        if !bool::from(expected.as_bytes().ct_eq(actual.as_bytes())) {
            bail!("Google access token hash did not match the ID token");
        }
    }
    Ok(claims)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use jsonwebtoken::{EncodingKey, Header, encode};
    use serde_json::{Value, json};

    pub(crate) fn jwks() -> JwkSet {
        serde_json::from_str(include_str!("../tests/fixtures/oidc/jwks.json")).unwrap()
    }

    pub(crate) fn claims() -> Value {
        let now = jsonwebtoken::get_current_timestamp();
        json!({
            "iss": "https://accounts.google.com", "sub": "google-user",
            "aud": "test-client", "exp": now + 600, "iat": now,
            "nonce": "test-nonce", "email": "test@example.com", "email_verified": true,
            "name": "Test User", "picture": "https://example.com/avatar.png",
            "at_hash": URL_SAFE_NO_PAD.encode(&Sha256::digest(b"access-token")[..16])
        })
    }

    pub(crate) fn signed(claims: &Value) -> String {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some("test-key".into());
        signed_header(claims, &header)
    }

    fn signed_header(claims: &Value, header: &Header) -> String {
        encode(
            header,
            claims,
            &EncodingKey::from_rsa_der(include_bytes!(
                "../tests/fixtures/oidc/test-only-private.der"
            )),
        )
        .unwrap()
    }

    fn verify(token: &str, keys: &JwkSet) -> Result<GoogleClaims> {
        verify_id_token(token, keys, "test-client", "test-nonce", "access-token")
    }

    #[test]
    fn verifies_real_rs256_signature_and_bound_identity() {
        let verified = verify(&signed(&claims()), &jwks()).unwrap();
        assert_eq!(verified.sub, "google-user");
        assert_eq!(verified.email, "test@example.com");
        let mut optional = claims();
        for field in ["at_hash", "name", "picture"] {
            optional.as_object_mut().unwrap().remove(field);
        }
        assert!(verify(&signed(&optional), &jwks()).is_ok());
        let mut multi = claims();
        multi["aud"] = json!(["test-client", "other-client"]);
        multi["azp"] = json!("test-client");
        assert!(verify(&signed(&multi), &jwks()).is_ok());
    }

    #[test]
    fn rejects_signed_tokens_with_invalid_or_missing_claims() {
        for (field, value) in [
            ("iss", json!("https://attacker.example")),
            ("aud", json!("other-client")),
            ("aud", json!([])),
            ("aud", json!(["other-client"])),
            ("azp", json!("other-client")),
            ("exp", json!(1)),
            ("nbf", json!(jsonwebtoken::get_current_timestamp() + 600)),
            ("iat", json!(jsonwebtoken::get_current_timestamp() + 600)),
            ("nonce", json!("wrong-nonce")),
            ("nonce", json!("")),
            ("at_hash", json!("wrong-hash")),
            ("email_verified", json!(false)),
            ("email_verified", json!("true")),
            ("email", json!(" ")),
            ("sub", json!("")),
            ("sub", json!("x".repeat(256))),
            ("sub", json!("non-ascii-λ")),
            ("exp", json!(jsonwebtoken::get_current_timestamp())),
        ] {
            let mut invalid = claims();
            invalid[field] = value;
            assert!(
                verify(&signed(&invalid), &jwks()).is_err(),
                "accepted invalid {field}"
            );
        }
        for field in [
            "iss",
            "sub",
            "aud",
            "exp",
            "iat",
            "nonce",
            "email",
            "email_verified",
        ] {
            let mut missing = claims();
            missing.as_object_mut().unwrap().remove(field);
            assert!(
                verify(&signed(&missing), &jwks()).is_err(),
                "accepted missing {field}"
            );
        }
        let mut multi = claims();
        multi["aud"] = json!(["test-client", "other-client"]);
        assert!(verify(&signed(&multi), &jwks()).is_err());
        assert!(
            verify_id_token(
                &signed(&claims()),
                &jwks(),
                "test-client",
                "test-nonce",
                "different-token"
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_algorithm_confusion_bad_signatures_and_untrusted_key_headers() {
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some("test-key".into());
        let hmac = encode(
            &header,
            &claims(),
            &EncodingKey::from_secret(include_bytes!("../tests/fixtures/oidc/public.pem")),
        )
        .unwrap();
        assert!(verify(&hmac, &jwks()).is_err());
        let token = signed(&claims());
        let mut parts: Vec<_> = token.split('.').map(str::to_owned).collect();
        parts[1] = URL_SAFE_NO_PAD.encode(br#"{"sub":"attacker"}"#);
        assert!(verify(&parts.join("."), &jwks()).is_err());
        parts = token.split('.').map(str::to_owned).collect();
        parts[2] = URL_SAFE_NO_PAD.encode([0_u8; 256]);
        assert!(verify(&parts.join("."), &jwks()).is_err());
        assert!(verify("not.a.token", &jwks()).is_err());
        header = Header::new(Algorithm::RS256);
        assert!(verify(&signed_header(&claims(), &header), &jwks()).is_err());
        header.kid = Some("unknown-key".into());
        header.jku = Some("http://attacker.example/keys".into());
        header.jwk = Some(jwks().keys.remove(0));
        assert!(verify(&signed_header(&claims(), &header), &jwks()).is_err());
        header.kid = Some("test-key".into());
        header.crit = Some(vec!["unknown-extension".into()]);
        assert!(verify(&signed_header(&claims(), &header), &jwks()).is_err());
    }

    #[test]
    fn rejects_wrong_key_metadata_and_accepts_rotated_provider_key_set() {
        let token = signed(&claims());
        for (field, value) in [
            ("kid", json!("old-key")),
            ("alg", json!("RS512")),
            ("use", json!("enc")),
            ("key_ops", json!(["sign"])),
        ] {
            let mut keys = serde_json::to_value(jwks()).unwrap();
            keys["keys"][0][field] = value;
            assert!(verify(&token, &serde_json::from_value(keys).unwrap()).is_err());
        }
        let mut keys = jwks();
        let mut old = keys.keys[0].clone();
        old.common.key_id = Some("old-key".into());
        keys.keys.insert(0, old);
        assert!(verify(&token, &keys).is_ok());
        keys.keys.push(keys.keys[1].clone());
        assert!(verify(&token, &keys).is_err());
        assert!(verify(&token, &JwkSet { keys: vec![] }).is_err());
    }
}
