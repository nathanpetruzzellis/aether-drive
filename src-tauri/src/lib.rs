pub mod crypto;
pub mod index;
pub mod storage;
pub mod storj;

use crate::crypto::{CryptoCore, KeyHierarchy, MasterKey, MkekCiphertext, PasswordSecret};
use crate::index::{sqlcipher::SqlCipherIndex, FileMetadata};
use crate::storage::aether_format::AetherFile;
use crate::storj::{StorjClient, StorjConfig};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as AsyncMutex;
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
    storj_client: AsyncMutex<Option<Arc<StorjClient>>>,
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
    state: &State<'_, AppState>,
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

    // Lors d'un bootstrap, on crée un NOUVEAU coffre.
    // Si une base existe déjà, elle appartient à un ancien coffre (ancienne MasterKey).
    // On doit la supprimer pour créer un nouveau coffre propre.
    if db_path.exists() {
        log::info!("Bootstrap: Existing database file found, removing it to create a new vault");
        if let Err(e) = std::fs::remove_file(&db_path) {
            log::warn!("Bootstrap: Failed to remove existing database file: {}, continuing anyway", e);
        } else {
            log::info!("Bootstrap: Old database file removed successfully");
        }
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
    let mut index = open_index_with_state(&app, &state)
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
    let index = open_index_with_state(&app, &state)?;
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
    let mut index = open_index_with_state(&app, &state)?;
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
    let index = open_index_with_state(&app, &state)?;
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
    let index = open_index_with_state(&app, &state)?;
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
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    data: Vec<u8>,
    logical_path: String,
) -> Result<Vec<u8>, String> {
    log::info!(
        "storage_encrypt_file called: logical_path={}, data_len={}",
        logical_path,
        data.len()
    );
    
    let master_key = {
        let master_key_guard = state
            .master_key
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let master_key = master_key_guard
            .as_ref()
            .ok_or_else(|| "MasterKey not available. Unlock the vault first.".to_string())?;
        
        // Clone la MasterKey pour l'utiliser
        let master_key_bytes = master_key.as_bytes().to_vec();
        crate::crypto::MasterKey::from_vec(master_key_bytes)
    };
    
    let aether_file = crate::storage::encrypt_file(&master_key, &data, &logical_path)
        .map_err(|e| format!("Failed to encrypt file: {}", e))?;
    
    let serialized = aether_file.to_bytes();
    
    // Utilise l'UUID comme FileId dans l'index local
    let uuid_hex = hex::encode(aether_file.header.uuid);
    let file_id = uuid_hex.clone();
    
    log::info!(
        "File encrypted successfully: serialized_size={}, uuid={:?}, file_id={}",
        serialized.len(),
        aether_file.header.uuid,
        file_id
    );
    
    // Ajoute automatiquement le fichier à l'index local après chiffrement
    match open_index_with_state(&app, &state) {
        Ok(mut index) => {
            let metadata = FileMetadata {
                logical_path: logical_path.clone(),
                encrypted_size: serialized.len() as u64,
            };
            
            match index.upsert(file_id.clone(), metadata) {
                Ok(_) => {
                    log::info!("File {} automatically added to local index after encryption", file_id);
                }
                Err(e) => {
                    log::warn!("Failed to add file {} to local index after encryption: {}", file_id, e);
                    // On continue quand même car le chiffrement a réussi
                }
            }
        }
        Err(e) => {
            log::warn!("Failed to open index for auto-add after encryption: {}", e);
            // On continue quand même car le chiffrement a réussi
        }
    }
    
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

#[derive(Debug, Deserialize)]
pub struct StorjConfigRequest {
    #[serde(rename = "accessKeyId")]
    pub access_key_id: String,
    #[serde(rename = "secretAccessKey")]
    pub secret_access_key: String,
    pub endpoint: String,
    #[serde(rename = "bucketName")]
    pub bucket_name: String,
}

#[tauri::command]
async fn storj_configure(
    state: State<'_, AppState>,
    config: StorjConfigRequest,
) -> Result<(), String> {
    log::info!("storj_configure called: endpoint={}, bucket={}", config.endpoint, config.bucket_name);
    
    let storj_config = StorjConfig::new(
        config.access_key_id,
        config.secret_access_key,
        config.endpoint,
        config.bucket_name,
    );
    
    let client = StorjClient::new(storj_config)
        .await
        .map_err(|e| {
            log::error!("Failed to create Storj client: {}", e);
            format!("Failed to create Storj client: {}", e)
        })?;
    
    let mut client_guard = state.storj_client.lock().await;
    *client_guard = Some(Arc::new(client));
    
    log::info!("Storj client configured successfully");
    Ok(())
}

#[tauri::command]
async fn storj_upload_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    encrypted_data: Vec<u8>,
    logical_path: String,
) -> Result<String, String> {
    log::info!("storj_upload_file called: logical_path={}, data_len={}", logical_path, encrypted_data.len());
    
    // Parse le fichier Aether pour obtenir l'UUID
    let aether_file = AetherFile::from_bytes(&encrypted_data)
        .map_err(|e| format!("Failed to parse Aether file: {}", e))?;
    
    // Utilise l'UUID comme clé d'objet dans Storj
    let uuid_hex = hex::encode(aether_file.header.uuid);
    let object_key = format!("{}", uuid_hex);
    
    log::info!("Preparing Storj upload: object_key={}, file_id={}", object_key, uuid_hex);
    
    // Utilise l'UUID comme FileId dans l'index local
    let file_id = uuid_hex.clone();
    
    let client = {
        let client_guard = state.storj_client.lock().await;
        client_guard.clone()
            .ok_or_else(|| "Storj client not configured. Call storj_configure first.".to_string())?
    };
    
    // Upload vers Storj
    let etag = client.upload_file(&object_key, &encrypted_data)
        .await
        .map_err(|e| {
            log::error!("Storj upload failed: object_key={}, error={}", object_key, e);
            format!("Failed to upload file to Storj: {}", e)
        })?;
    
    log::info!("File uploaded successfully to Storj: object_key={}, etag={}", object_key, etag);
    
    // Synchronise avec l'index local : ajoute l'entrée après upload réussi
    let mut index = open_index_with_state(&app, &state)
        .map_err(|e| {
            log::error!("Failed to open index for sync: {}", e);
            format!("Failed to sync with local index: {}", e)
        })?;
    
    let metadata = FileMetadata {
        logical_path: logical_path.clone(),
        encrypted_size: encrypted_data.len() as u64,
    };
    
    index.upsert(file_id.clone(), metadata)
        .map_err(|e| {
            log::error!("Failed to add file to index after Storj upload: {}", e);
            format!("File uploaded to Storj but failed to sync with local index: {}", e)
        })?;
    
    log::info!("File synchronized with local index: file_id={}, logical_path={}", file_id, logical_path);
    Ok(etag)
}

#[tauri::command]
async fn storj_download_file(
    state: State<'_, AppState>,
    file_uuid: Vec<u8>,
) -> Result<Vec<u8>, String> {
    log::info!("storj_download_file called: uuid={:?}", file_uuid);
    
    if file_uuid.len() != 16 {
        return Err("Invalid UUID length".to_string());
    }
    
    // Utilise l'UUID comme clé d'objet dans Storj
    let uuid_hex = hex::encode(&file_uuid);
    let object_key = format!("{}", uuid_hex);
    
    let client = {
        let client_guard = state.storj_client.lock().await;
        client_guard.clone()
            .ok_or_else(|| "Storj client not configured. Call storj_configure first.".to_string())?
    };
    
    let data = client.download_file(&object_key)
        .await
        .map_err(|e| format!("Failed to download file from Storj: {}", e))?;
    
    log::info!("File downloaded successfully from Storj: object_key={}, data_len={}", object_key, data.len());
    Ok(data)
}

#[derive(Debug, Serialize)]
pub struct StorjFileInfo {
    pub uuid: String,
    pub logical_path: Option<String>,
    pub encrypted_size: Option<u64>,
}

#[tauri::command]
async fn storj_list_files(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<StorjFileInfo>, String> {
    log::info!("storj_list_files called");
    
    let client = {
        let client_guard = state.storj_client.lock().await;
        client_guard.clone()
            .ok_or_else(|| "Storj client not configured. Call storj_configure first.".to_string())?
    };
    
    let keys = client.list_files()
        .await
        .map_err(|e| format!("Failed to list files from Storj: {}", e))?;
    
    log::info!("Listed {} files from Storj", keys.len());
    for key in &keys {
        log::info!("Storj key format: {}", key);
    }
    
    // Normalise les UUIDs Storj (enlève les tirets) pour correspondre au format de l'index local
    let storj_uuids_normalized: std::collections::HashSet<String> = keys
        .iter()
        .map(|uuid| {
            let normalized = uuid.replace("-", "").to_lowercase();
            log::info!("Normalized UUID: {} -> {}", uuid, normalized);
            normalized
        })
        .collect();
    
    // Pour chaque UUID, essaie de trouver les métadonnées dans l'index local
    // Si l'index n'est pas disponible, on retourne juste les UUIDs sans métadonnées
    let mut files_with_metadata = Vec::new();
    
    match open_index_with_state(&app, &state) {
        Ok(mut index) => {
            // Nettoyage de l'index local : supprime les fichiers qui n'existent plus dans Storj
            let all_local_files = index.list_all().ok().unwrap_or_default();
            log::info!("Local index contains {} files", all_local_files.len());
            
            for (file_id, _) in &all_local_files {
                log::info!("Checking local file_id: {}", file_id);
            }
            
            for (file_id, _) in all_local_files {
                if !storj_uuids_normalized.contains(&file_id) {
                    log::info!("Removing orphaned file from local index: {}", file_id);
                    if let Err(e) = index.remove(&file_id) {
                        log::warn!("Failed to remove orphaned file {}: {}", file_id, e);
                    }
                }
            }
            
            // Maintenant, récupère les métadonnées pour chaque fichier Storj
            for uuid_from_storj in keys {
                // Normalise l'UUID : enlève les tirets pour correspondre au format de l'index local
                let uuid_normalized = uuid_from_storj.replace("-", "").to_lowercase();
                
                // Essaie de trouver le fichier dans l'index local avec l'UUID normalisé
                log::info!("Looking for file in local index: normalized={}, original={}", uuid_normalized, uuid_from_storj);
                let mut metadata = index.get(&uuid_normalized).ok().flatten();
                
                if metadata.is_some() {
                    log::info!("Found file {} in local index", uuid_normalized);
                } else {
                    log::info!("File {} not found in local index", uuid_normalized);
                }
                
                // Si le fichier n'est pas dans l'index local, essaie de le télécharger depuis Storj
                // pour extraire les métadonnées depuis le fichier Aether lui-même
                if metadata.is_none() {
                    log::info!("File {} not found in local index, attempting to sync from Storj (original UUID: {})", uuid_normalized, uuid_from_storj);
                    
                    // Télécharge le fichier depuis Storj pour extraire les métadonnées
                    // Essaie d'abord avec l'UUID normalisé (sans tirets), puis avec le format original (avec tirets)
                    let client_for_sync = {
                        let client_guard = state.storj_client.lock().await;
                        client_guard.clone()
                            .ok_or_else(|| "Storj client not configured".to_string())?
                    };
                    
                    // Essaie d'abord avec l'UUID normalisé (sans tirets) - format utilisé lors de l'upload
                    log::info!("Attempting download with normalized UUID: {}", uuid_normalized);
                    let mut download_result = client_for_sync.download_file(&uuid_normalized).await;
                    
                    // Si ça échoue, essaie avec le format original (avec tirets) - format retourné par Storj
                    if download_result.is_err() {
                        log::info!("Download with normalized UUID failed, trying with original UUID format: {}", uuid_from_storj);
                        download_result = client_for_sync.download_file(&uuid_from_storj).await;
                    }
                    
                    match download_result {
                        Ok(encrypted_data) => {
                            log::info!("Successfully downloaded file {} from Storj, size: {} bytes", uuid_normalized, encrypted_data.len());
                            
                            // Vérifie que le fichier est assez grand pour être un fichier Aether valide
                            // Un fichier Aether doit avoir au minimum : Magic(4) + Version(1) + CipherID(1) + UUID(16) + Salt(32) + HMAC(32) + Nonce(24) + CiphertextLen(8) = 118 bytes
                            const MIN_AETHER_SIZE: usize = 118;
                            if encrypted_data.len() < MIN_AETHER_SIZE {
                                log::warn!("⚠️ File {} from Storj is too small ({} bytes) to be a valid Aether file (minimum {} bytes). Skipping sync.", 
                                    uuid_normalized, encrypted_data.len(), MIN_AETHER_SIZE);
                            } else {
                                // Vérifie le Magic Number "AETH"
                                if encrypted_data.len() >= 4 && &encrypted_data[0..4] != b"AETH" {
                                    log::warn!("⚠️ File {} from Storj does not have Aether magic number. First 4 bytes: {:?}. Skipping sync.", 
                                        uuid_normalized, &encrypted_data[0..4.min(encrypted_data.len())]);
                                } else {
                                    // Parse le fichier Aether pour extraire les métadonnées
                                    match AetherFile::from_bytes(&encrypted_data) {
                                        Ok(_aether_file) => {
                                            log::info!("Successfully parsed Aether file {}", uuid_normalized);
                                            
                                            // Le fichier Aether contient le chemin logique dans l'AAD
                                            // Mais on ne peut pas le récupérer sans déchiffrer
                                            // Pour l'instant, on crée une entrée avec un chemin logique générique
                                            // L'utilisateur devra le corriger manuellement ou re-uploader le fichier
                                            let sync_metadata = FileMetadata {
                                                logical_path: format!("/storj/{}", uuid_normalized), // Chemin générique
                                                encrypted_size: encrypted_data.len() as u64,
                                            };
                                            
                                            log::info!("Attempting to upsert file {} to local index", uuid_normalized);
                                            match index.upsert(uuid_normalized.clone(), sync_metadata.clone()) {
                                                Ok(_) => {
                                                    log::info!("✅ File {} successfully synced to local index from Storj", uuid_normalized);
                                                    metadata = Some(sync_metadata);
                                                }
                                                Err(e) => {
                                                    log::error!("❌ Failed to sync file {} to local index: {}", uuid_normalized, e);
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            log::warn!("⚠️ Failed to parse Aether file {} from Storj: {}. File may not be in Aether format or may be corrupted.", uuid_normalized, e);
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("❌ Failed to download file {} from Storj for sync: {}", uuid_normalized, e);
                        }
                    }
                }
                
                files_with_metadata.push(StorjFileInfo {
                    uuid: uuid_from_storj.clone(), // Garde le format original pour l'affichage
                    logical_path: metadata.as_ref().map(|m| m.logical_path.clone()),
                    encrypted_size: metadata.as_ref().map(|m| m.encrypted_size),
                });
            }
        }
        Err(_) => {
            // Index non disponible, retourne juste les UUIDs sans métadonnées
            for uuid in keys {
                files_with_metadata.push(StorjFileInfo {
                    uuid,
                    logical_path: None,
                    encrypted_size: None,
                });
            }
        }
    }
    
    Ok(files_with_metadata)
}

#[tauri::command]
async fn storj_delete_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    file_uuid: Vec<u8>,
) -> Result<(), String> {
    log::info!("storj_delete_file called: uuid={:?}", file_uuid);
    
    if file_uuid.len() != 16 {
        return Err("Invalid UUID length".to_string());
    }
    
    let uuid_hex = hex::encode(&file_uuid);
    let object_key = format!("{}", uuid_hex);
    let file_id = uuid_hex.clone();
    
    let client = {
        let client_guard = state.storj_client.lock().await;
        client_guard.clone()
            .ok_or_else(|| "Storj client not configured. Call storj_configure first.".to_string())?
    };
    
    // Supprime de Storj
    client.delete_file(&object_key)
        .await
        .map_err(|e| format!("Failed to delete file from Storj: {}", e))?;
    
    log::info!("File deleted successfully from Storj: object_key={}", object_key);
    
    // Synchronise avec l'index local : supprime l'entrée après suppression Storj réussie
    let mut index = open_index_with_state(&app, &state)
        .map_err(|e| {
            log::error!("Failed to open index for sync: {}", e);
            format!("File deleted from Storj but failed to sync with local index: {}", e)
        })?;
    
    if let Err(e) = index.remove(&file_id) {
        log::warn!("File deleted from Storj but not found in local index (may have been already removed): {}", e);
        // On continue car le fichier a été supprimé de Storj avec succès
    }
    
    log::info!("File synchronized with local index (removed): file_id={}", file_id);
    Ok(())
}

#[tauri::command]
async fn storj_download_file_by_path(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    logical_path: String,
) -> Result<Vec<u8>, String> {
    log::info!("storj_download_file_by_path called: logical_path={}", logical_path);
    
    // Cherche le fichier dans l'index local par chemin logique
    let file_id = {
        let index = open_index_with_state(&app, &state)
            .map_err(|e| format!("Failed to open index: {}", e))?;
        
        // Liste tous les fichiers et trouve celui avec le chemin logique correspondant
        let entries = index.list_all()
            .map_err(|e| format!("Failed to list files from index: {}", e))?;
        
        let (file_id, _metadata) = entries
            .into_iter()
            .find(|(_, meta)| meta.logical_path == logical_path)
            .ok_or_else(|| format!("File not found in local index: {}", logical_path))?;
        
        log::info!("Found file in index: file_id={}, logical_path={}", file_id, logical_path);
        file_id
    };
    
    // Convertit le file_id (UUID hex) en bytes pour le download Storj
    let file_uuid = hex::decode(&file_id)
        .map_err(|e| format!("Invalid UUID format in index: {}", e))?;
    
    if file_uuid.len() != 16 {
        return Err(format!("Invalid UUID length in index: expected 16 bytes, got {}", file_uuid.len()));
    }
    
    // Télécharge depuis Storj en utilisant l'UUID
    let uuid_array: [u8; 16] = file_uuid.try_into()
        .map_err(|_| "Failed to convert UUID to array".to_string())?;
    
    // Appelle directement le client Storj
    let client = {
        let client_guard = state.storj_client.lock().await;
        client_guard.clone()
            .ok_or_else(|| "Storj client not configured. Call storj_configure first.".to_string())?
    };
    
    let uuid_hex = hex::encode(&uuid_array);
    let object_key = format!("{}", uuid_hex);
    
    let data = client.download_file(&object_key)
        .await
        .map_err(|e| format!("Failed to download file from Storj: {}", e))?;
    
    log::info!("File downloaded successfully from Storj via index lookup: logical_path={}", logical_path);
    Ok(data)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            master_key: Mutex::new(None),
            storj_client: AsyncMutex::new(None),
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
            storage_get_file_info,
            storj_configure,
            storj_upload_file,
            storj_download_file,
            storj_download_file_by_path,
            storj_list_files,
            storj_delete_file
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
