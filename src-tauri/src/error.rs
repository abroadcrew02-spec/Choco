use serde::Serialize;
use thiserror::Error;

#[derive(Serialize, Error, Debug)]
pub enum AppError {
    #[error("file io: {0}")]
    FileIo(String),

    #[error("image decode: {0}")]
    Decode(String),

    #[error("validation: {0}")]
    Validation(String),

    #[error("internal: {0}")]
    Internal(String),
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::FileIo(e.to_string())
    }
}
