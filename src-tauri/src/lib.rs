pub mod crypto;
pub mod index;

use crate::crypto::{CryptoCore, KeyHierarchy, MkekCiphertext, PasswordSecret};
use crate::index::sqlcipher::SqlCipherIndex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

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

/// Obtient le chemin de la base de données SQLCipher dans le répertoire de données de l'app.
fn get_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&app_data).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(app_data.join("index.db"))
}

#[tauri::command]
fn crypto_bootstrap(app: tauri::AppHandle, password: String) -> Result<MkekBootstrapResponse, String> {
    log::info!("Starting crypto_bootstrap");
    
    let core = CryptoCore::default();
    let password_secret = PasswordSecret::new(password);
    let salt = core.random_password_salt();
    log::info!("Password salt generated");
    
    let hierarchy = KeyHierarchy::bootstrap(&password_secret, salt)
        .map_err(|e| {
            log::error!("KeyHierarchy::bootstrap failed: {}", e);
            e.to_string()
        })?;
    log::info!("KeyHierarchy bootstrapped successfully");
    
    let mkek = hierarchy.seal_master_key()
        .map_err(|e| {
            log::error!("seal_master_key failed: {}", e);
            e.to_string()
        })?;
    log::info!("Master key sealed into MKEK");

    // Ouvre/crée l'index SQLCipher avec la MasterKey.
    let db_path = get_db_path(&app)
        .map_err(|e| {
            log::error!("get_db_path failed: {}", e);
            e
        })?;
    log::info!("Database path: {}", db_path.to_string_lossy());
    
    let master_key_bytes = hierarchy.master_key().as_bytes();
    if master_key_bytes.len() != 32 {
        let err = format!("MasterKey length is {} instead of 32", master_key_bytes.len());
        log::error!("{}", err);
        return Err(err);
    }
    
    SqlCipherIndex::open(&db_path, master_key_bytes)
        .map_err(|e| {
            log::error!("SqlCipherIndex::open failed: {}", e);
            format!("Failed to open SQLCipher index: {}", e)
        })?;
    log::info!("SQLCipher index opened successfully");

    Ok(MkekBootstrapResponse {
        password_salt: salt,
        mkek,
    })
}

#[tauri::command]
fn get_index_db_path(app: tauri::AppHandle) -> Result<String, String> {
    let db_path = get_db_path(&app)?;
    Ok(db_path.to_string_lossy().to_string())
}

#[derive(Debug, Serialize)]
pub struct IndexStatus {
    pub db_path: String,
    pub file_count: usize,
    pub exists: bool,
}

#[tauri::command]
fn get_index_status(app: tauri::AppHandle, req: MkekUnlockRequest) -> Result<IndexStatus, String> {
    let password_secret = PasswordSecret::new(req.password);
    let hierarchy = KeyHierarchy::restore(&password_secret, req.password_salt, &req.mkek)
        .map_err(|e| e.to_string())?;

    let db_path = get_db_path(&app)?;
    let exists = db_path.exists();
    
    if !exists {
        return Ok(IndexStatus {
            db_path: db_path.to_string_lossy().to_string(),
            file_count: 0,
            exists: false,
        });
    }

    let master_key_bytes = hierarchy.master_key().as_bytes();
    let index = SqlCipherIndex::open(&db_path, master_key_bytes)
        .map_err(|e| format!("Failed to open SQLCipher index: {}", e))?;
    
    let file_count = index.len().map_err(|e| format!("Failed to get index length: {}", e))?;

    Ok(IndexStatus {
        db_path: db_path.to_string_lossy().to_string(),
        file_count,
        exists: true,
    })
}

#[tauri::command]
fn crypto_unlock(app: tauri::AppHandle, req: MkekUnlockRequest) -> Result<(), String> {
    let password_secret = PasswordSecret::new(req.password);
    let hierarchy = KeyHierarchy::restore(&password_secret, req.password_salt, &req.mkek)
        .map_err(|e| e.to_string())?;

    // Ouvre l'index SQLCipher existant avec la MasterKey restaurée.
    let db_path = get_db_path(&app)?;
    let master_key_bytes = hierarchy.master_key().as_bytes();
    SqlCipherIndex::open(&db_path, master_key_bytes)
        .map_err(|e| format!("Failed to open SQLCipher index: {}", e))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![crypto_bootstrap, crypto_unlock, get_index_db_path, get_index_status])
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
