use std::{sync::Arc, time::Duration};

use aes_gcm::{
    Aes256Gcm,
    aead::{Aead, AeadCore, KeyInit, OsRng},
};
use anyhow::{Context, Result, anyhow, bail};
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{DateTime, Utc};
use openidconnect::{
    AccessTokenHash, AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl,
    Nonce as OidcNonce, OAuth2TokenResponse, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl,
    Scope, TokenResponse,
    core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata},
    reqwest,
};
use tokio::sync::OnceCell;

use crate::config::GoogleOAuthConfig;

const GOOGLE_ISSUER: &str = "https://accounts.google.com";

#[derive(Clone)]
pub struct GoogleOAuth {
    inner: Arc<GoogleOAuthInner>,
}

struct GoogleOAuthInner {
    config: GoogleOAuthConfig,
    http_client: reqwest::Client,
    provider_metadata: OnceCell<CoreProviderMetadata>,
    token_cipher: Aes256Gcm,
}

pub struct GoogleLoginStart {
    pub authorization_url: String,
    pub state: String,
    pub nonce: String,
    pub pkce_verifier: String,
}

pub struct GoogleCredentials {
    pub encrypted_access_token: Vec<u8>,
    pub encrypted_refresh_token: Option<Vec<u8>>,
    pub access_token_expires_at: Option<DateTime<Utc>>,
    pub scopes: Vec<String>,
}

pub struct GoogleAccessToken {
    pub token: String,
    pub encrypted_token: Option<Vec<u8>>,
    pub expires_at: Option<DateTime<Utc>>,
}

pub struct GoogleLoginResult {
    pub subject: String,
    pub email: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub encrypted_access_token: Vec<u8>,
    pub encrypted_refresh_token: Option<Vec<u8>>,
    pub access_token_expires_at: Option<DateTime<Utc>>,
    pub scopes: Vec<String>,
}

impl GoogleOAuth {
    pub fn new(config: GoogleOAuthConfig) -> Result<Self> {
        let key = STANDARD
            .decode(config.token_encryption_key.trim())
            .context("TOKEN_ENCRYPTION_KEY must be valid base64")?;
        let token_cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|_| anyhow!("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes"))?;
        let http_client = reqwest::ClientBuilder::new()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .context("failed to create Google OAuth HTTP client")?;

        Ok(Self {
            inner: Arc::new(GoogleOAuthInner {
                config,
                http_client,
                provider_metadata: OnceCell::new(),
                token_cipher,
            }),
        })
    }

    pub async fn begin_login(&self) -> Result<GoogleLoginStart> {
        self.begin_authorization(false).await
    }

    pub async fn begin_calendar_connection(&self) -> Result<GoogleLoginStart> {
        self.begin_authorization(true).await
    }

    async fn begin_authorization(&self, calendar_access: bool) -> Result<GoogleLoginStart> {
        let metadata = self.provider_metadata().await?.clone();
        let client = CoreClient::from_provider_metadata(
            metadata,
            ClientId::new(self.inner.config.client_id.clone()),
            Some(ClientSecret::new(self.inner.config.client_secret.clone())),
        )
        .set_redirect_uri(RedirectUrl::new(self.inner.config.redirect_uri.clone())?);
        let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
        let request = client
            .authorize_url(
                CoreAuthenticationFlow::AuthorizationCode,
                CsrfToken::new_random,
                OidcNonce::new_random,
            )
            .add_scope(Scope::new("openid".to_owned()))
            .add_scope(Scope::new("email".to_owned()))
            .add_scope(Scope::new("profile".to_owned()))
            .add_extra_param("access_type", "offline");
        let request = if calendar_access {
            request
                .add_scope(Scope::new(
                    "https://www.googleapis.com/auth/calendar.events".to_owned(),
                ))
                .add_scope(Scope::new(
                    "https://www.googleapis.com/auth/calendar.calendarlist.readonly".to_owned(),
                ))
                .add_extra_param("prompt", "consent")
        } else {
            request
        };
        let (authorization_url, state, nonce) = request.set_pkce_challenge(pkce_challenge).url();

        Ok(GoogleLoginStart {
            authorization_url: authorization_url.to_string(),
            state: state.secret().to_owned(),
            nonce: nonce.secret().to_owned(),
            pkce_verifier: pkce_verifier.secret().to_owned(),
        })
    }

    pub async fn complete_login(
        &self,
        code: String,
        nonce: String,
        pkce_verifier: String,
    ) -> Result<GoogleLoginResult> {
        let metadata = self.provider_metadata().await?.clone();
        let client = CoreClient::from_provider_metadata(
            metadata,
            ClientId::new(self.inner.config.client_id.clone()),
            Some(ClientSecret::new(self.inner.config.client_secret.clone())),
        )
        .set_redirect_uri(RedirectUrl::new(self.inner.config.redirect_uri.clone())?);
        let token_response = client
            .exchange_code(AuthorizationCode::new(code))?
            .set_pkce_verifier(PkceCodeVerifier::new(pkce_verifier))
            .request_async(&self.inner.http_client)
            .await
            .context("Google rejected the authorization code")?;
        let id_token = token_response
            .id_token()
            .ok_or_else(|| anyhow!("Google did not return an ID token"))?;
        let verifier = client.id_token_verifier();
        let claims = id_token
            .claims(&verifier, &OidcNonce::new(nonce))
            .context("Google returned an invalid ID token")?;

        if let Some(expected_hash) = claims.access_token_hash() {
            let actual_hash = AccessTokenHash::from_token(
                token_response.access_token(),
                id_token.signing_alg()?,
                id_token.signing_key(&verifier)?,
            )?;
            if actual_hash != *expected_hash {
                bail!("Google access token hash did not match the ID token");
            }
        }

        if claims.email_verified() != Some(true) {
            bail!("Google account email must be verified");
        }
        let email = claims
            .email()
            .map(|value| value.as_str().to_owned())
            .ok_or_else(|| anyhow!("Google did not provide an email address"))?;
        let display_name = claims
            .name()
            .and_then(|value| value.get(None))
            .map(|value| value.as_str().to_owned())
            .unwrap_or_else(|| email.clone());
        let avatar_url = claims
            .picture()
            .and_then(|value| value.get(None))
            .map(|value| value.as_str().to_owned());
        let access_token_expires_at = token_response
            .expires_in()
            .and_then(|duration| chrono::Duration::from_std(duration).ok())
            .map(|duration| Utc::now() + duration);
        let scopes = token_response
            .scopes()
            .map(|scopes| {
                scopes
                    .iter()
                    .map(|scope| scope.as_str().to_owned())
                    .collect()
            })
            .unwrap_or_default();

        Ok(GoogleLoginResult {
            subject: claims.subject().as_str().to_owned(),
            email,
            display_name,
            avatar_url,
            encrypted_access_token: self
                .encrypt(token_response.access_token().secret().as_bytes())?,
            encrypted_refresh_token: token_response
                .refresh_token()
                .map(|token| self.encrypt(token.secret().as_bytes()))
                .transpose()?,
            access_token_expires_at,
            scopes,
        })
    }

    pub async fn access_token(&self, credentials: &GoogleCredentials) -> Result<GoogleAccessToken> {
        let still_valid = credentials
            .access_token_expires_at
            .is_none_or(|expires_at| expires_at > Utc::now() + chrono::Duration::seconds(60));
        if still_valid {
            return Ok(GoogleAccessToken {
                token: String::from_utf8(self.decrypt(&credentials.encrypted_access_token)?)
                    .context("stored Google access token was not UTF-8")?,
                encrypted_token: None,
                expires_at: credentials.access_token_expires_at,
            });
        }
        let refresh_token = credentials
            .encrypted_refresh_token
            .as_ref()
            .ok_or_else(|| anyhow!("Google authorization has expired and cannot be refreshed"))?;
        let refresh_token = String::from_utf8(self.decrypt(refresh_token)?)
            .context("stored Google refresh token was not UTF-8")?;
        let response = self
            .inner
            .http_client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", self.inner.config.client_id.as_str()),
                ("client_secret", self.inner.config.client_secret.as_str()),
                ("refresh_token", refresh_token.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .context("failed to refresh Google access token")?
            .error_for_status()
            .context("Google rejected the refresh token")?
            .json::<RefreshTokenResponse>()
            .await
            .context("Google returned an invalid refresh response")?;
        let expires_at = Utc::now() + chrono::Duration::seconds(response.expires_in);
        Ok(GoogleAccessToken {
            encrypted_token: Some(self.encrypt(response.access_token.as_bytes())?),
            token: response.access_token,
            expires_at: Some(expires_at),
        })
    }

    pub async fn revoke(&self, credentials: &GoogleCredentials) -> Result<()> {
        let encrypted_token = credentials
            .encrypted_refresh_token
            .as_ref()
            .unwrap_or(&credentials.encrypted_access_token);
        let token = String::from_utf8(self.decrypt(encrypted_token)?)
            .context("stored Google credential was not UTF-8")?;
        let response = self
            .inner
            .http_client
            .post("https://oauth2.googleapis.com/revoke")
            .form(&[("token", token)])
            .send()
            .await
            .context("failed to revoke Google credential")?;
        if response.status().is_server_error() {
            response
                .error_for_status()
                .context("Google credential revocation is unavailable")?;
        }
        Ok(())
    }

    async fn provider_metadata(&self) -> Result<&CoreProviderMetadata> {
        self.inner
            .provider_metadata
            .get_or_try_init(|| async {
                CoreProviderMetadata::discover_async(
                    IssuerUrl::new(GOOGLE_ISSUER.to_owned())?,
                    &self.inner.http_client,
                )
                .await
                .context("failed to discover Google OpenID configuration")
            })
            .await
    }

    fn decrypt(&self, encrypted: &[u8]) -> Result<Vec<u8>> {
        if encrypted.len() <= 12 {
            bail!("stored Google credential is invalid");
        }
        let (nonce, ciphertext) = encrypted.split_at(12);
        self.inner
            .token_cipher
            .decrypt(aes_gcm::Nonce::from_slice(nonce), ciphertext)
            .map_err(|_| anyhow!("failed to decrypt Google credential"))
    }

    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = self
            .inner
            .token_cipher
            .encrypt(&nonce, plaintext)
            .map_err(|_| anyhow!("failed to encrypt Google credential"))?;
        let mut encrypted = nonce.to_vec();
        encrypted.extend(ciphertext);
        Ok(encrypted)
    }
}

#[derive(serde::Deserialize)]
struct RefreshTokenResponse {
    access_token: String,
    expires_in: i64,
}
