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
pub struct Config {
    pub environment: Environment,
    pub bind_address: SocketAddr,
    pub database_url: String,
    pub database_max_connections: u32,
    pub cors_allowed_origin: String,
    pub allow_insecure_dev_auth: bool,
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
        let allow_insecure_dev_auth = env::var("ALLOW_INSECURE_DEV_AUTH")
            .unwrap_or_else(|_| "true".to_owned())
            .parse()
            .context("ALLOW_INSECURE_DEV_AUTH must be true or false")?;

        if environment == Environment::Production && allow_insecure_dev_auth {
            bail!("ALLOW_INSECURE_DEV_AUTH cannot be enabled in production");
        }

        Ok(Self {
            environment,
            bind_address,
            database_url,
            database_max_connections,
            cors_allowed_origin,
            allow_insecure_dev_auth,
        })
    }
}
