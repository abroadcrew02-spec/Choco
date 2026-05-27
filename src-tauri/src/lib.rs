mod commands;
mod error;

use commands::file_io::{open_image, ping, save_image};
use commands::update_check::check_update_version;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            open_image,
            save_image,
            check_update_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
