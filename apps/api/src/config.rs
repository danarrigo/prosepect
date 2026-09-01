use std::{env, net::SocketAddr, str::FromStr};

use anyhow::{Context, Result, bail};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Environment {
    Development,
    Test,
    Production,
}

impl FromStr for Environment {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "development" => Ok(Self::Development),
            "test" => Ok(Self::Test),
            "production" => Ok(Self::Production),
            _ => bail!("APP_ENV must be development, test, or production"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct GoogleOAuthConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub token_encryption_key: String,
}

#[derive(Debug, Clone)]
pub enum ObjectStorageConfig {
    Local {
        root: String,
    },
    S3 {
        bucket: String,
        region: String,
        endpoint: Option<String>,
        public_endpoint: Option<String>,
        access_key_id: String,
        secret_access_key: String,
        allow_http: bool,
        virtual_hosted_style: bool,
    },
}

#[derive(Debug, Clone)]
pub struct Config {
    pub environment: Environment,
    pub bind_address: SocketAddr,
    pub database_url: String,
    pub database_max_connections: u32,
    pub cors_allowed_origin: String,
    pub app_url: String,
    pub allow_insecure_dev_auth: bool,
    pub invite_only: bool,
    pub trust_proxy_headers: bool,
    pub google_oauth: Option<GoogleOAuthConfig>,
    pub object_storage: ObjectStorageConfig,
    pub max_file_size_bytes: usize,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let environment = env::var("APP_ENV")
            .unwrap_or_else(|_| "development".to_owned())
            .parse()?;
        let bind_address = env::var("BIND_ADDRESS")
            .unwrap_or_else(|_| "127.0.0.1:3000".to_owned())
            .parse()
            .context("BIND_ADDRESS must be a socket address")?;
        let database_url = env::var("DATABASE_URL").context("DATABASE_URL must be configured")?;
        let database_max_connections = env::var("DATABASE_MAX_CONNECTIONS")
            .unwrap_or_else(|_| "10".to_owned())
            .parse()
            .context("DATABASE_MAX_CONNECTIONS must be a positive integer")?;
        if database_max_connections == 0 {
            bail!("DATABASE_MAX_CONNECTIONS must be greater than zero");
        }

        let cors_allowed_origin =
            env::var("CORS_ALLOWED_ORIGIN").unwrap_or_else(|_| "http://localhost:5173".to_owned());
        let app_url = env::var("APP_URL").unwrap_or_else(|_| cors_allowed_origin.clone());
        let allow_insecure_dev_auth = env::var("ALLOW_INSECURE_DEV_AUTH")
            .unwrap_or_else(|_| "true".to_owned())
            .parse()
            .context("ALLOW_INSECURE_DEV_AUTH must be true or false")?;

        if environment == Environment::Production && allow_insecure_dev_auth {
            bail!("ALLOW_INSECURE_DEV_AUTH cannot be enabled in production");
        }
        let invite_only = env::var("INVITE_ONLY")
            .unwrap_or_else(|_| "false".to_owned())
            .parse()
            .context("INVITE_ONLY must be true or false")?;
        let trust_proxy_headers = env::var("TRUST_PROXY_HEADERS")
            .unwrap_or_else(|_| "false".to_owned())
            .parse()
            .context("TRUST_PROXY_HEADERS must be true or false")?;

        let google_values = [
            env_nonempty("GOOGLE_CLIENT_ID"),
            env_nonempty("GOOGLE_CLIENT_SECRET"),
            env_nonempty("GOOGLE_REDIRECT_URI"),
            env_nonempty("TOKEN_ENCRYPTION_KEY"),
        ];
        let google_oauth = match google_values {
            [
                Some(client_id),
                Some(client_secret),
                Some(redirect_uri),
                Some(token_encryption_key),
            ] => Some(GoogleOAuthConfig {
                client_id,
                client_secret,
                redirect_uri,
                token_encryption_key,
            }),
            [None, None, None, None] => None,
            _ => bail!(
                "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, and TOKEN_ENCRYPTION_KEY must be configured together"
            ),
        };
        if environment == Environment::Production && google_oauth.is_none() {
            bail!("Google OAuth configuration is required in production");
        }

        let s3_values = [
            env_nonempty("S3_BUCKET"),
            env_nonempty("S3_REGION"),
            env_nonempty("S3_ACCESS_KEY_ID"),
            env_nonempty("S3_SECRET_ACCESS_KEY"),
        ];
        let object_storage = match s3_values {
            [
                Some(bucket),
                Some(region),
                Some(access_key_id),
                Some(secret_access_key),
            ] => ObjectStorageConfig::S3 {
                bucket,
                region,
                endpoint: env_nonempty("S3_ENDPOINT"),
                public_endpoint: env_nonempty("S3_PUBLIC_ENDPOINT"),
                access_key_id,
                secret_access_key,
                allow_http: env::var("S3_ALLOW_HTTP")
                    .unwrap_or_else(|_| "false".to_owned())
                    .parse()
                    .context("S3_ALLOW_HTTP must be true or false")?,
                virtual_hosted_style: env::var("S3_VIRTUAL_HOSTED_STYLE")
                    .unwrap_or_else(|_| "false".to_owned())
                    .parse()
                    .context("S3_VIRTUAL_HOSTED_STYLE must be true or false")?,
            },
            [None, None, None, None] if environment != Environment::Production => {
                ObjectStorageConfig::Local {
                    root: env::var("FILE_STORAGE_PATH")
                        .unwrap_or_else(|_| "./data/files".to_owned()),
                }
            }
            [None, None, None, None] => bail!("S3 object storage is required in production"),
            _ => bail!(
                "S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY must be configured together"
            ),
        };

        let max_file_size_bytes = env::var("MAX_FILE_SIZE_BYTES")
            .unwrap_or_else(|_| (25 * 1024 * 1024).to_string())
            .parse::<usize>()
            .context("MAX_FILE_SIZE_BYTES must be a positive integer")?;
        if !(1..=100 * 1024 * 1024).contains(&max_file_size_bytes) {
            bail!("MAX_FILE_SIZE_BYTES must be between 1 byte and 100 MiB");
        }

        Ok(Self {
            environment,
            bind_address,
            database_url,
            database_max_connections,
            cors_allowed_origin,
            app_url,
            allow_insecure_dev_auth,
            invite_only,
            trust_proxy_headers,
            google_oauth,
            object_storage,
            max_file_size_bytes,
        })
    }
}

fn env_nonempty(name: &str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.trim().is_empty())
}
