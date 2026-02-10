pub(crate) mod hash;
pub(crate) mod store;
pub(crate) mod validation;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtractionError {
    message: String,
}

impl From<std::io::Error> for ExtractionError {
    fn from(err: std::io::Error) -> Self {
        ExtractionError {
            message: err.to_string(),
        }
    }
}

impl From<String> for ExtractionError {
    fn from(msg: String) -> Self {
        ExtractionError { message: msg }
    }
}

impl std::fmt::Display for ExtractionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
