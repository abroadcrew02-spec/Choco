use crate::error::AppError;

/// Minimum command for M1 connectivity check.
/// Returns a greeting string to verify IPC is working.
#[tauri::command]
pub async fn ping(message: String) -> Result<String, AppError> {
    Ok(format!("pong: {}", message))
}

/// Placeholder for image open - full implementation in M2.
#[tauri::command]
pub async fn open_image(_path: String) -> Result<(), AppError> {
    Err(AppError::Internal("open_image not yet implemented (M2)".to_string()))
}

/// Placeholder for image save - full implementation in M5.
#[tauri::command]
pub async fn save_image(_path: String, _data: Vec<u8>) -> Result<(), AppError> {
    Err(AppError::Internal("save_image not yet implemented (M5)".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ping_returns_pong() {
        let result = ping("hello".to_string()).await.unwrap();
        assert_eq!(result, "pong: hello");
    }

    #[tokio::test]
    async fn test_ping_empty_message() {
        let result = ping(String::new()).await.unwrap();
        assert_eq!(result, "pong: ");
    }
}
