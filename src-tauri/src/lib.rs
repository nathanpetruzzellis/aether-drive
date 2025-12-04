pub mod crypto;
pub mod index;
pub mod storage;

use crate::crypto::{CryptoCore, KeyHierarchy, MasterKey, MkekCiphertext, PasswordSecret};
use crate::index::{sqlcipher::SqlCipherIndex, FileMetadata};
use crate::storage::aether_format::AetherFile;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

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

/// État global stockant la MasterKey après déverrouillage (en mémoire uniquement).
struct AppState {
    master_key: Mutex<Option<MasterKey>>,
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

/// Ouvre l'index SQLCipher en utilisant la MasterKey stockée dans l'état global.
fn open_index_with_state(
    app: &tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SqlCipherIndex, String> {
    let master_key_guard = state
        .master_key
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let master_key = master_key_guard
        .as_ref()
        .ok_or_else(|| "MasterKey not available. Unlock the vault first.".to_string())?;

    let db_path = get_db_path(app)?;
    let master_key_bytes = master_key.as_bytes();
    log::info!(
        "open_index_with_state: Opening index with MasterKey (length: {})",
        master_key_bytes.len()
    );
    SqlCipherIndex::open(&db_path, master_key_bytes)
        .map_err(|e| {
            log::error!("open_index_with_state: Failed to open SQLCipher index: {}", e);
            format!("Failed to open SQLCipher index: {}", e)
        })
}

#[tauri::command]
fn crypto_bootstrap(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    password: String,
) -> Result<MkekBootstrapResponse, String> {
    log::info!("Starting crypto_bootstrap");

    let core = CryptoCore::default();
    let password_secret = PasswordSecret::new(password);
    let salt = core.random_password_salt();
    log::info!("Password salt generated");

    let hierarchy = KeyHierarchy::bootstrap(&password_secret, salt).map_err(|e| {
        log::error!("KeyHierarchy::bootstrap failed: {}", e);
        e.to_string()
    })?;
    log::info!("KeyHierarchy bootstrapped successfully");

    let mkek = hierarchy.seal_master_key().map_err(|e| {
        log::error!("seal_master_key failed: {}", e);
        e.to_string()
    })?;
    log::info!("Master key sealed into MKEK");

    // Ouvre/crée l'index SQLCipher avec la MasterKey.
    let db_path = get_db_path(&app).map_err(|e| {
        log::error!("get_db_path failed: {}", e);
        e
    })?;
    log::info!("Database path: {}", db_path.to_string_lossy());

    let master_key_bytes = hierarchy.master_key().as_bytes();
    if master_key_bytes.len() != 32 {
        let err = format!(
            "MasterKey length is {} instead of 32",
            master_key_bytes.len()
        );
        log::error!("{}", err);
        return Err(err);
    }

    SqlCipherIndex::open(&db_path, master_key_bytes).map_err(|e| {
        log::error!("SqlCipherIndex::open failed: {}", e);
        format!("Failed to open SQLCipher index: {}", e)
    })?;
    log::info!("SQLCipher index opened successfully");

    // Stocke la MasterKey dans l'état global pour les opérations d'index ultérieures.
    let mut master_key_guard = state
        .master_key
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let master_key_bytes_vec = hierarchy.master_key().as_bytes().to_vec();
    *master_key_guard = Some(crate::crypto::MasterKey::from_vec(master_key_bytes_vec));
    log::info!("MasterKey stored in AppState");

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

    let file_count = index
        .len()
        .map_err(|e| format!("Failed to get index length: {}", e))?;

    Ok(IndexStatus {
        db_path: db_path.to_string_lossy().to_string(),
        file_count,
        exists: true,
    })
}

#[tauri::command]
fn crypto_unlock(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    req: MkekUnlockRequest,
) -> Result<(), String> {
    let password_secret = PasswordSecret::new(req.password);
    let hierarchy = KeyHierarchy::restore(&password_secret, req.password_salt, &req.mkek)
        .map_err(|e| e.to_string())?;

    // Ouvre l'index SQLCipher existant avec la MasterKey restaurée.
    let db_path = get_db_path(&app)?;
    let master_key_bytes = hierarchy.master_key().as_bytes();
    SqlCipherIndex::open(&db_path, master_key_bytes)
        .map_err(|e| format!("Failed to open SQLCipher index: {}", e))?;

    // Stocke la MasterKey dans l'état global pour les opérations d'index ultérieures.
    // NOTE: La MasterKey reste uniquement en mémoire (RAM volatile), conformément à la blueprint.
    let mut master_key_guard = state
        .master_key
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    // Clone la MasterKey pour la stocker (elle sera zeroized à la drop).
    // On doit extraire les bytes et recréer une MasterKey car elle n'implémente pas Clone.
    let master_key_bytes_vec = hierarchy.master_key().as_bytes().to_vec();
    *master_key_guard = Some(crate::crypto::MasterKey::from_vec(master_key_bytes_vec));

    Ok(())
}

#[derive(Debug, Serialize)]
pub struct FileEntry {
    pub id: String,
    pub logical_path: String,
    pub encrypted_size: u64,
}

#[derive(Debug, Deserialize)]
pub struct AddFileRequest {
    #[serde(rename = "fileId")]
    pub file_id: String,
    #[serde(rename = "logicalPath")]
    pub logical_path: String,
    #[serde(rename = "encryptedSize")]
    pub encrypted_size: u64,
}

#[tauri::command]
fn index_add_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    req: AddFileRequest,
) -> Result<(), String> {
    log::info!(
        "index_add_file called: file_id={}, logical_path={}, encrypted_size={}",
        req.file_id,
        req.logical_path,
        req.encrypted_size
    );
    let mut index = open_index_with_state(&app, state)
        .map_err(|e| {
            log::error!("open_index_with_state failed: {}", e);
            e
        })?;
    let metadata = FileMetadata {
        logical_path: req.logical_path.clone(),
        encrypted_size: req.encrypted_size,
    };
    index
        .upsert(req.file_id.clone(), metadata)
        .map_err(|e| {
            log::error!("upsert failed: {}", e);
            format!("Failed to add file to index: {}", e)
        })?;
    log::info!("File {} successfully added to index", req.file_id);
    Ok(())
}

#[tauri::command]
fn index_list_files(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<FileEntry>, String> {
    let index = open_index_with_state(&app, state)?;
    let entries = index
        .list_all()
        .map_err(|e| format!("Failed to list files: {}", e))?;
    Ok(entries
        .into_iter()
        .map(|(id, meta)| FileEntry {
            id,
            logical_path: meta.logical_path,
            encrypted_size: meta.encrypted_size,
        })
        .collect())
}

#[tauri::command]
fn index_remove_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    file_id: String,
) -> Result<(), String> {
    let mut index = open_index_with_state(&app, state)?;
    index
        .remove(&file_id)
        .map_err(|e| format!("Failed to remove file from index: {}", e))?;
    Ok(())
}

#[tauri::command]
fn index_get_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    file_id: String,
) -> Result<Option<FileEntry>, String> {
    let index = open_index_with_state(&app, state)?;
    let metadata = index
        .get(&file_id)
        .map_err(|e| format!("Failed to get file from index: {}", e))?;
    Ok(metadata.map(|meta| FileEntry {
        id: file_id,
        logical_path: meta.logical_path,
        encrypted_size: meta.encrypted_size,
    }))
}

#[tauri::command]
fn index_verify_integrity(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let index = open_index_with_state(&app, state)?;
    let is_valid = index
        .verify_integrity()
        .map_err(|e| format!("Failed to verify index integrity: {}", e))?;
    Ok(is_valid)
}

/// Obtient la MasterKey depuis l'état global (doit être déverrouillée).
fn get_master_key_from_state(state: State<'_, AppState>) -> Result<MasterKey, String> {
    let master_key_guard = state
        .master_key
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let master_key = master_key_guard
        .as_ref()
        .ok_or_else(|| "MasterKey not available. Unlock the vault first.".to_string())?;
    
    // Clone la MasterKey pour l'utiliser
    let master_key_bytes = master_key.as_bytes().to_vec();
    Ok(crate::crypto::MasterKey::from_vec(master_key_bytes))
}

#[derive(Debug, Serialize)]
pub struct FileInfo {
    pub uuid: Vec<u8>,
    pub version: u8,
    pub cipher_id: u8,
    pub encrypted_size: usize,
}

#[tauri::command]
fn storage_encrypt_file(
    state: State<'_, AppState>,
    data: Vec<u8>,
    logical_path: String,
) -> Result<Vec<u8>, String> {
    log::info!(
        "storage_encrypt_file called: logical_path={}, data_len={}",
        logical_path,
        data.len()
    );
    
    let master_key = get_master_key_from_state(state)?;
    
    let aether_file = crate::storage::encrypt_file(&master_key, &data, &logical_path)
        .map_err(|e| format!("Failed to encrypt file: {}", e))?;
    
    let serialized = aether_file.to_bytes();
    log::info!(
        "File encrypted successfully: serialized_size={}, uuid={:?}",
        serialized.len(),
        aether_file.header.uuid
    );
    
    Ok(serialized)
}

#[tauri::command]
fn storage_decrypt_file(
    state: State<'_, AppState>,
    encrypted_data: Vec<u8>,
    logical_path: String,
) -> Result<Vec<u8>, String> {
    log::info!(
        "storage_decrypt_file called: logical_path={}, encrypted_data_len={}",
        logical_path,
        encrypted_data.len()
    );
    
    let master_key = get_master_key_from_state(state)?;
    
    let aether_file = AetherFile::from_bytes(&encrypted_data)
        .map_err(|e| format!("Failed to parse Aether file: {}", e))?;
    
    let plaintext = crate::storage::decrypt_file(&master_key, &aether_file, &logical_path)
        .map_err(|e| format!("Failed to decrypt file: {}", e))?;
    
    log::info!("File decrypted successfully: plaintext_len={}", plaintext.len());
    
    Ok(plaintext)
}

#[tauri::command]
fn storage_get_file_info(encrypted_data: Vec<u8>) -> Result<FileInfo, String> {
    log::info!("storage_get_file_info called: encrypted_data_len={}", encrypted_data.len());
    
    let aether_file = AetherFile::from_bytes(&encrypted_data)
        .map_err(|e| format!("Failed to parse Aether file: {}", e))?;
    
    Ok(FileInfo {
        uuid: aether_file.header.uuid.to_vec(),
        version: aether_file.header.version,
        cipher_id: aether_file.header.cipher_id,
        encrypted_size: aether_file.ciphertext.len(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            master_key: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            crypto_bootstrap,
            crypto_unlock,
            get_index_db_path,
            get_index_status,
            index_add_file,
            index_list_files,
            index_remove_file,
            index_get_file,
            index_verify_integrity,
            storage_encrypt_file,
            storage_decrypt_file,
            storage_get_file_info
        ])
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
