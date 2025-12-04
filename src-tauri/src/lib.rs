pub mod crypto;

use crate::crypto::{CryptoCore, KeyHierarchy, MkekCiphertext, PasswordSecret};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct MkekBootstrapResponse {
    pub password_salt: [u8; 16],
    pub mkek: MkekCiphertext,
}

#[derive(Debug, Deserialize)]
pub struct MkekUnlockRequest {
    pub password: String,
    pub password_salt: [u8; 16],
    pub mkek: MkekCiphertext,
}

#[tauri::command]
fn crypto_bootstrap(password: String) -> Result<MkekBootstrapResponse, String> {
    let core = CryptoCore::default();
    let password_secret = PasswordSecret::new(password);
    let salt = core.random_password_salt();
    let hierarchy = KeyHierarchy::bootstrap(&password_secret, salt).map_err(|e| e.to_string())?;
    let mkek = hierarchy.seal_master_key().map_err(|e| e.to_string())?;

    Ok(MkekBootstrapResponse {
        password_salt: salt,
        mkek,
    })
}

#[tauri::command]
fn crypto_unlock(req: MkekUnlockRequest) -> Result<(), String> {
    let password_secret = PasswordSecret::new(req.password);
    let _hierarchy = KeyHierarchy::restore(&password_secret, req.password_salt, &req.mkek)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![crypto_bootstrap, crypto_unlock])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
