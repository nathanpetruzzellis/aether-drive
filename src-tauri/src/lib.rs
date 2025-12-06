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
use rand::RngCore;

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

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub old_password: String,
    pub new_password: String,
    pub old_password_salt: [u8; 16],
    pub old_mkek: MkekCiphertext,
}

#[derive(Debug, Serialize)]
pub struct ChangePasswordResponse {
    pub new_password_salt: [u8; 16],
    pub new_mkek: MkekCiphertext,
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

/// Supprime la base de données locale (utile en cas de conflit avec Wayne).
#[tauri::command]
fn reset_local_database(app: tauri::AppHandle) -> Result<(), String> {
    let db_path = get_db_path(&app)?;
    if db_path.exists() {
        std::fs::remove_file(&db_path).map_err(|e| {
            format!("Failed to remove database file: {}", e)
        })?;
        log::info!("Local database file removed successfully");
    }
    Ok(())
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
    
    // Vérifie si la base existe avant d'essayer de l'ouvrir
    let db_exists = db_path.exists();
    
    match SqlCipherIndex::open(&db_path, master_key_bytes) {
        Ok(_) => {
            // Base ouverte avec succès
        }
        Err(e) => {
            let error_msg = format!("Failed to open SQLCipher index: {}", e);
            
            // Si la base existe mais qu'on ne peut pas l'ouvrir, c'est probablement une clé incorrecte
            if db_exists {
                return Err(format!(
                    "{}. La clé de déchiffrement ne correspond pas à la base de données existante. \
                    Cela peut arriver si tu as créé un nouveau coffre localement mais que tu essaies \
                    de déverrouiller avec un MKEK d'un ancien coffre depuis Wayne. \
                    Solution : Supprime la base locale (elle sera recréée) ou utilise le bon MKEK.",
                    error_msg
                ));
            }
            
            return Err(error_msg);
        }
    }

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

/// Change le mot de passe sans re-chiffrer les données.
/// 
/// Le processus :
/// 1. Déchiffre le MKEK avec l'ancien mot de passe pour obtenir la MasterKey
/// 2. Génère un nouveau salt
/// 3. Dérive une nouvelle KEK avec le nouveau mot de passe
/// 4. Re-chiffre la MasterKey avec la nouvelle KEK (nouveau MKEK)
/// 
/// La MasterKey reste la même, seule la façon de la chiffrer change.
#[tauri::command]
fn crypto_change_password(
    req: ChangePasswordRequest,
) -> Result<ChangePasswordResponse, String> {
    use crate::crypto::mkek;
    
    log::info!("Starting password change");
    
    // Étape 1 : Déchiffre le MKEK avec l'ancien mot de passe pour obtenir la MasterKey
    let old_password_secret = PasswordSecret::new(req.old_password);
    let old_hierarchy = KeyHierarchy::restore(
        &old_password_secret,
        req.old_password_salt,
        &req.old_mkek,
    )
    .map_err(|e| {
        log::error!("Failed to restore hierarchy with old password: {}", e);
        format!("Ancien mot de passe incorrect: {}", e)
    })?;
    
    // Récupère la MasterKey (elle reste la même)
    let master_key = old_hierarchy.master_key();
    
    // Étape 2 : Génère un nouveau salt pour le nouveau mot de passe
    let core = CryptoCore::default();
    let new_password_salt = core.random_password_salt();
    log::info!("New password salt generated");
    
    // Étape 3 : Dérive une nouvelle KEK avec le nouveau mot de passe
    let new_password_secret = PasswordSecret::new(req.new_password);
    let new_kek = core.derive_kek(&new_password_secret, &new_password_salt)
        .map_err(|e| {
            log::error!("Failed to derive new KEK: {}", e);
            format!("Erreur lors de la dérivation de la nouvelle clé: {}", e)
        })?;
    
    // Étape 4 : Re-chiffre la MasterKey avec la nouvelle KEK (nouveau MKEK)
    let new_mkek = mkek::encrypt_master_key(&new_kek, master_key)
        .map_err(|e| {
            log::error!("Failed to encrypt master key with new KEK: {}", e);
            format!("Erreur lors du chiffrement avec la nouvelle clé: {}", e)
        })?;
    
    log::info!("Password change successful");
    
    Ok(ChangePasswordResponse {
        new_password_salt,
        new_mkek,
    })
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

/// Représente un dossier dans la hiérarchie
#[derive(Debug, Serialize)]
pub struct FolderInfo {
    pub name: String,
    pub path: String,
}

/// Représente un fichier ou un dossier dans un chemin donné
#[derive(Debug, Serialize)]
pub struct DirectoryEntry {
    pub files: Vec<FileEntry>,
    pub folders: Vec<FolderInfo>,
}

/// Normalise un chemin (supprime les doubles slashes, termine par / si c'est un dossier)
fn normalize_path(path: &str) -> String {
    let mut normalized = path.replace("//", "/");
    if !normalized.starts_with('/') {
        normalized = format!("/{}", normalized);
    }
    normalized
}

/// Vérifie si un chemin est un préfixe d'un autre
fn is_prefix(prefix: &str, path: &str) -> bool {
    let prefix = normalize_path(prefix);
    let path = normalize_path(path);
    
    // Cas spécial : si le préfixe est "/", tous les chemins qui commencent par "/" sont valides
    if prefix == "/" {
        return path.starts_with("/");
    }
    
    // Pour les autres cas, vérifie que le path commence par le prefix et que le caractère suivant est "/" ou la fin
    path.starts_with(&prefix) && (path.len() == prefix.len() || path.chars().nth(prefix.len()) == Some('/'))
}

/// Extrait le chemin parent d'un chemin
fn get_parent_path(path: &str) -> String {
    let path = normalize_path(path);
    if path == "/" {
        return "/".to_string();
    }
    let path = path.trim_end_matches('/');
    if let Some(last_slash) = path.rfind('/') {
        if last_slash == 0 {
            "/".to_string()
        } else {
            path[..last_slash].to_string()
        }
    } else {
        "/".to_string()
    }
}

/// Extrait le nom du fichier ou dossier depuis un chemin complet
fn get_name_from_path(path: &str) -> String {
    let path = path.trim_end_matches('/');
    path.split('/').last().unwrap_or("").to_string()
}

#[tauri::command]
fn list_files_and_folders(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    parent_path: Option<String>,
) -> Result<DirectoryEntry, String> {
    let parent = parent_path.as_deref().unwrap_or("/");
    let parent_normalized = normalize_path(parent);
    
    log::info!("list_files_and_folders called: parent_path={:?}, parent_normalized={}", parent_path, parent_normalized);
    
    let index = open_index_with_state(&app, &state)?;
    let entries = index
        .list_all()
        .map_err(|e| format!("Failed to list files: {}", e))?;
    
    log::info!("Found {} total entries in index", entries.len());
    for (id, meta) in &entries {
        log::info!("  Entry: id={}, path={}, size={}", id, meta.logical_path, meta.encrypted_size);
    }
    
    let mut files = Vec::new();
    let mut folder_paths = std::collections::HashSet::new();
    
    for (id, meta) in entries {
        // IMPORTANT: Ne normalise PAS le chemin pour les dossiers, car normalize_path supprime le slash final
        // On utilise le chemin original pour détecter les dossiers
        let original_path = &meta.logical_path;
        let file_path = normalize_path(original_path);
        
        // Si le chemin original se termine par / OU si encrypted_size = 0, c'est un dossier vide
        let is_folder = original_path.ends_with('/') || meta.encrypted_size == 0;
        
        if is_folder {
            // C'est un dossier vide
            // Pour un dossier, on doit vérifier si son parent correspond au parent_normalized
            // Exemple : dossier "/dossier1/" a pour parent "/"
            // Utilise le chemin original (qui se termine par /) pour extraire le parent
            let folder_path_clean = original_path.trim_end_matches('/');
            let folder_parent = if folder_path_clean == "/" || folder_path_clean.is_empty() {
                "/".to_string()
            } else {
                get_parent_path(folder_path_clean)
            };
            
            log::info!("Checking folder: original_path={}, folder_path_clean={}, folder_parent={}, parent_normalized={}", original_path, folder_path_clean, folder_parent, parent_normalized);
            
            // Normalise les deux chemins pour la comparaison
            let folder_parent_normalized = normalize_path(&folder_parent);
            let parent_normalized_clean = normalize_path(&parent_normalized);
            
            if folder_parent_normalized == parent_normalized_clean {
                let folder_name = get_name_from_path(original_path);
                if !folder_name.is_empty() {
                    // Utilise le chemin original qui se termine déjà par /
                    let folder_path_normalized = if original_path.ends_with('/') {
                        original_path.clone()
                    } else {
                        format!("{}/", original_path)
                    };
                    let folder_path_normalized_clone = folder_path_normalized.clone();
                    folder_paths.insert(folder_path_normalized);
                    log::info!("✅ Added empty folder: {} (original_path: {}, normalized: {})", folder_name, original_path, folder_path_normalized_clone);
                } else {
                    log::warn!("⚠️ Folder name is empty for path: {}", original_path);
                }
            } else {
                log::info!("⏭️ Folder {} not in parent {} (folder_parent: {})", original_path, parent_normalized, folder_parent);
            }
            continue; // Skip les dossiers dans le traitement des fichiers
        }
        
        // Vérifie si le fichier est dans le chemin parent
        let is_in_parent = is_prefix(&parent_normalized, &file_path);
        log::info!("Checking file {} (path: {}): is_in_parent={}", id, file_path, is_in_parent);
        
        if !is_in_parent {
            continue;
        }
        
        // Extrait le chemin relatif au parent
        let relative_path = if parent_normalized == "/" {
            file_path.trim_start_matches('/').to_string()
        } else {
            file_path.strip_prefix(&parent_normalized)
                .unwrap_or(&file_path)
                .trim_start_matches('/')
                .to_string()
        };
        
        // Si le chemin relatif est vide, on skip (ne devrait pas arriver)
        if relative_path.is_empty() {
            log::warn!("Empty relative path for file {}", id);
            continue;
        }
        
        // Si le chemin relatif contient un slash, c'est dans un sous-dossier
        if relative_path.contains('/') {
            // Extrait le nom du premier sous-dossier
            let first_folder = relative_path.split('/').next().unwrap_or("");
            if !first_folder.is_empty() {
                let folder_path = if parent_normalized == "/" {
                    format!("/{}", first_folder)
                } else {
                    format!("{}/{}", parent_normalized, first_folder)
                };
                folder_paths.insert(folder_path);
                log::info!("Added folder: {}", first_folder);
            }
        } else {
            // C'est un fichier directement dans le parent
            let file_id = id.clone();
            files.push(FileEntry {
                id,
                logical_path: meta.logical_path,
                encrypted_size: meta.encrypted_size,
            });
            log::info!("Added file: {} (relative_path: {})", file_id, relative_path);
        }
    }
    
    // Convertit les chemins de dossiers en FolderInfo
    let folders: Vec<FolderInfo> = folder_paths
        .into_iter()
        .map(|path| FolderInfo {
            name: get_name_from_path(&path),
            path: path.clone(),
        })
        .collect();
    
    log::info!("Returning {} files and {} folders", files.len(), folders.len());
    
    Ok(DirectoryEntry { files, folders })
}

/// Crée un dossier vide dans l'index
#[tauri::command]
fn create_folder(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    folder_name: String,
    parent_path: Option<String>,
) -> Result<String, String> {
    let parent = parent_path.as_deref().unwrap_or("/");
    let parent_normalized = normalize_path(parent);
    
    // Valide le nom du dossier
    if folder_name.is_empty() {
        return Err("Le nom du dossier ne peut pas être vide".to_string());
    }
    if folder_name.contains('/') {
        return Err("Le nom du dossier ne peut pas contenir de slash".to_string());
    }
    
    // Génère un UUID pour le dossier (comme pour les fichiers)
    let mut uuid_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut uuid_bytes);
    let folder_id = hex::encode(uuid_bytes);
    
    // Construit le chemin complet du dossier (se termine par /)
    let folder_path = if parent_normalized == "/" {
        format!("/{}/", folder_name)
    } else {
        format!("{}/{}/", parent_normalized, folder_name)
    };
    
    log::info!("Creating folder: {} (path: {}, id: {})", folder_name, folder_path, folder_id);
    
    // Vérifie si le dossier existe déjà
    let index_check = open_index_with_state(&app, &state)?;
    let all_entries = index_check.list_all()
        .map_err(|e| format!("Failed to check existing folders: {}", e))?;
    
    for (_, meta) in all_entries {
        let existing_path = normalize_path(&meta.logical_path);
        if existing_path == folder_path || existing_path == folder_path.trim_end_matches('/') {
            return Err(format!("Un dossier avec le nom '{}' existe déjà", folder_name));
        }
    }
    
    // Ajoute le dossier dans l'index avec encrypted_size = 0 (indique que c'est un dossier)
    let mut index = open_index_with_state(&app, &state)?;
    let metadata = FileMetadata {
        logical_path: folder_path.clone(),
        encrypted_size: 0, // 0 indique que c'est un dossier vide
    };
    
    index.upsert(folder_id.clone(), metadata)
        .map_err(|e| format!("Failed to create folder in index: {}", e))?;
    
    log::info!("Folder created successfully: {}", folder_path);
    
    Ok(folder_path)
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

#[derive(Debug, Serialize)]
pub struct SelectedFile {
    pub path: String,
    pub name: String,
    pub data: Vec<u8>,
    pub size: usize,
}

/// Sélectionne un fichier depuis le système de fichiers et retourne son contenu.
#[tauri::command]
async fn select_and_read_file(app: tauri::AppHandle) -> Result<SelectedFile, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;
    
    log::info!("select_and_read_file called");
    
    // Utilise un oneshot channel pour recevoir le résultat de manière asynchrone
    let (tx, rx) = oneshot::channel();
    
    // Ouvre le dialogue de sélection de fichier
    app.dialog()
        .file()
        .set_title("Sélectionner un fichier à chiffrer")
        .pick_file(move |path_opt| {
            let _ = tx.send(path_opt);
        });
    
    // Attendre le résultat avec timeout
    let path_opt = tokio::time::timeout(std::time::Duration::from_secs(30), rx)
        .await
        .map_err(|_| "Timeout lors de la sélection de fichier".to_string())?
        .map_err(|_| "Erreur lors de la réception du résultat".to_string())?;
    
    let file_path = path_opt.ok_or_else(|| "Aucun fichier sélectionné".to_string())?;
    // FilePath implémente Display, on peut le convertir en String puis en PathBuf
    let path_buf = PathBuf::from(file_path.to_string());
    let path_str = path_buf.to_string_lossy().to_string();
    let file_name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("fichier")
        .to_string();
    
    log::info!("File selected: path={}, name={}", path_str, file_name);
    
    // Lit le contenu du fichier de manière asynchrone
    let data = tokio::fs::read(&path_buf)
        .await
        .map_err(|e| format!("Erreur lors de la lecture du fichier: {}", e))?;
    
    let size = data.len();
    log::info!("File read successfully: size={} bytes", size);
    
    Ok(SelectedFile {
        path: path_str,
        name: file_name,
        data,
        size,
    })
}

/// Lit un fichier depuis un chemin de fichier (utilisé pour le drag & drop natif).
#[tauri::command]
async fn select_and_read_file_from_path(file_path: String) -> Result<SelectedFile, String> {
    log::info!("select_and_read_file_from_path called: path={}", file_path);
    
    let path_buf = PathBuf::from(&file_path);
    let path_str = path_buf.to_string_lossy().to_string();
    let file_name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("fichier")
        .to_string();
    
    log::info!("Reading file: path={}, name={}", path_str, file_name);
    
    // Lit le contenu du fichier de manière asynchrone
    let data = tokio::fs::read(&path_buf)
        .await
        .map_err(|e| format!("Erreur lors de la lecture du fichier: {}", e))?;
    
    let size = data.len();
    log::info!("File read successfully: size={} bytes", size);
    
    Ok(SelectedFile {
        path: path_str,
        name: file_name,
        data,
        size,
    })
}

/// Sauvegarde un fichier déchiffré en utilisant un dialogue de sauvegarde.
#[tauri::command]
async fn save_decrypted_file(
    app: tauri::AppHandle,
    data: Vec<u8>,
    suggested_name: String,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;
    
    log::info!("save_decrypted_file called: suggested_name={}, data_len={}", suggested_name, data.len());
    
    // Utilise un oneshot channel pour recevoir le résultat de manière asynchrone
    let (tx, rx) = oneshot::channel();
    
    // Ouvre le dialogue de sauvegarde de fichier
    app.dialog()
        .file()
        .set_title("Sauvegarder le fichier déchiffré")
        .set_file_name(&suggested_name)
        .save_file(move |path_opt| {
            let _ = tx.send(path_opt);
        });
    
    // Attendre le résultat avec timeout
    let path_opt = tokio::time::timeout(std::time::Duration::from_secs(30), rx)
        .await
        .map_err(|_| "Timeout lors de la sélection du fichier de sauvegarde".to_string())?
        .map_err(|_| "Erreur lors de la réception du résultat".to_string())?;
    
    let file_path = path_opt.ok_or_else(|| "Aucun fichier sélectionné pour la sauvegarde".to_string())?;
    let path_buf = PathBuf::from(file_path.to_string());
    let path_str = path_buf.to_string_lossy().to_string();
    
    log::info!("Saving file to: {}", path_str);
    
    // Sauvegarde le fichier de manière asynchrone
    tokio::fs::write(&path_buf, &data)
        .await
        .map_err(|e| format!("Erreur lors de l'écriture du fichier: {}", e))?;
    
    log::info!("File saved successfully: {}", path_str);
    
    Ok(path_str)
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
    
    // Normalise les UUIDs Storj (enlève les tirets) pour correspondre au format de l'index local
    let storj_uuids_normalized: std::collections::HashSet<String> = keys
        .iter()
        .map(|uuid| uuid.replace("-", "").to_lowercase())
        .collect();
    
    // Pour chaque UUID, essaie de trouver les métadonnées dans l'index local
    // Si l'index n'est pas disponible, on retourne juste les UUIDs sans métadonnées
    let mut files_with_metadata = Vec::new();
    
    match open_index_with_state(&app, &state) {
        Ok(mut index) => {
            // Nettoyage de l'index local : supprime les fichiers qui n'existent plus dans Storj
            let all_local_files = index.list_all().ok().unwrap_or_default();
            log::info!("Local index contains {} files", all_local_files.len());
            
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
                let mut metadata = index.get(&uuid_normalized).ok().flatten();
                
                // Si le fichier n'est pas dans l'index local, on skip la synchronisation automatique
                // pour éviter de télécharger tous les fichiers (très coûteux en bande passante)
                // L'utilisateur peut forcer une synchronisation manuelle si nécessaire
                if metadata.is_none() {
                    log::warn!("⚠️ File {} not found in local index, skipping auto-sync (too expensive). Original UUID: {}", uuid_normalized, uuid_from_storj);
                    // On continue sans télécharger le fichier pour économiser la bande passante
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
    let file_id = uuid_hex.clone();
    
    // Déplace vers la corbeille au lieu de supprimer définitivement
    // Le fichier reste sur Storj jusqu'à ce qu'on vide la corbeille ou qu'on supprime définitivement
    let mut index = open_index_with_state(&app, &state)
        .map_err(|e| {
            log::error!("Failed to open index for trash: {}", e);
            format!("Failed to open index: {}", e)
        })?;
    
    // Récupère les métadonnées du fichier avant de le déplacer
    let metadata = index.get(&file_id)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?
        .ok_or_else(|| format!("File not found in index: {}", file_id))?;
    
    // Déplace vers la corbeille
    index.move_to_trash(&file_id, &metadata)
        .map_err(|e| format!("Failed to move file to trash: {}", e))?;
    
    log::info!("File moved to trash: file_id={}, logical_path={}", file_id, metadata.logical_path);
    Ok(())
}

/// Renomme un fichier (télécharge, déchiffre, re-chiffre avec nouveau chemin, re-upload, met à jour index)
#[tauri::command]
async fn rename_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    old_logical_path: String,
    new_logical_path: String,
) -> Result<String, String> {
    log::info!("rename_file called: old_path={}, new_path={}", old_logical_path, new_logical_path);
    
    // Étape 1 : Trouve le fichier dans l'index local par ancien chemin
    let file_id = {
        let index = open_index_with_state(&app, &state)
            .map_err(|e| format!("Failed to open index: {}", e))?;
        
        let entries = index.list_all()
            .map_err(|e| format!("Failed to list files from index: {}", e))?;
        
        let (file_id, _metadata) = entries
            .into_iter()
            .find(|(_, meta)| meta.logical_path == old_logical_path)
            .ok_or_else(|| format!("File not found in local index: {}", old_logical_path))?;
        
        log::info!("Found file in index: file_id={}, old_logical_path={}", file_id, old_logical_path);
        file_id
    };
    
    // Étape 2 : Télécharge le fichier depuis Storj
    log::info!("Downloading file from Storj: file_id={}", file_id);
    let encrypted_data = {
        let file_uuid = hex::decode(&file_id)
            .map_err(|e| format!("Invalid UUID format in index: {}", e))?;
        
        if file_uuid.len() != 16 {
            return Err(format!("Invalid UUID length in index: expected 16 bytes, got {}", file_uuid.len()));
        }
        
        let uuid_array: [u8; 16] = file_uuid.try_into()
            .map_err(|_| "Failed to convert UUID to array".to_string())?;
        
        storj_download_file(state.clone(), uuid_array.to_vec()).await?
    };
    
    log::info!("File downloaded from Storj: size={} bytes", encrypted_data.len());
    
    // Étape 3 : Déchiffre le fichier avec l'ancien logical_path
    log::info!("Decrypting file with old logical_path: {}", old_logical_path);
    let plaintext = storage_decrypt_file(state.clone(), encrypted_data.clone(), old_logical_path.clone())
        .map_err(|e| format!("Failed to decrypt file: {}", e))?;
    
    log::info!("File decrypted successfully: plaintext_len={}", plaintext.len());
    
    // Étape 4 : Re-chiffre avec le nouveau logical_path (génère un nouveau UUID)
    log::info!("Re-encrypting file with new logical_path: {}", new_logical_path);
    let new_encrypted_data = storage_encrypt_file(app.clone(), state.clone(), plaintext, new_logical_path.clone())
        .map_err(|e| format!("Failed to re-encrypt file: {}", e))?;
    
    // Récupère le nouveau UUID du fichier re-chiffré
    let new_file_info = storage_get_file_info(new_encrypted_data.clone())
        .map_err(|e| format!("Failed to get file info: {}", e))?;
    let new_uuid_hex = hex::encode(&new_file_info.uuid);
    
    log::info!("File re-encrypted successfully: new_uuid={}, new_size={}", new_uuid_hex, new_encrypted_data.len());
    
    // Étape 5 : Upload le nouveau fichier vers Storj
    log::info!("Uploading renamed file to Storj: new_uuid={}", new_uuid_hex);
    let _upload_result = storj_upload_file(app.clone(), state.clone(), new_encrypted_data, new_logical_path.clone()).await
        .map_err(|e| format!("Failed to upload renamed file to Storj: {}", e))?;
    
    log::info!("Renamed file uploaded successfully to Storj");
    
    // Étape 6 : Supprime l'ancien fichier de Storj
    log::info!("Deleting old file from Storj: old_uuid={}", file_id);
    let old_uuid_bytes = hex::decode(&file_id)
        .map_err(|e| format!("Invalid UUID format: {}", e))?;
    let old_uuid_array: [u8; 16] = old_uuid_bytes.try_into()
        .map_err(|_| "Failed to convert UUID to array".to_string())?;
    
    storj_delete_file(app.clone(), state.clone(), old_uuid_array.to_vec()).await
        .map_err(|e| format!("Failed to delete old file from Storj: {}", e))?;
    
    log::info!("Old file deleted successfully from Storj");
    
    // Étape 7 : L'index local a déjà été mis à jour par storage_encrypt_file et storj_upload_file
    // Mais on doit supprimer l'ancienne entrée de l'index
    {
        let mut index = open_index_with_state(&app, &state)
            .map_err(|e| format!("Failed to open index for cleanup: {}", e))?;
        
        index.remove(&file_id)
            .map_err(|e| format!("Failed to remove old file from index: {}", e))?;
        
        log::info!("Old file entry removed from local index");
    }
    
    log::info!("✅ File renamed successfully: {} -> {} (old_uuid={}, new_uuid={})", old_logical_path, new_logical_path, file_id, new_uuid_hex);
    
    Ok(new_uuid_hex)
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

/// Télécharge et déchiffre un fichier pour l'aperçu (retourne les données déchiffrées en mémoire)
#[tauri::command]
async fn preview_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    file_id: String,
) -> Result<Vec<u8>, String> {
    log::info!("preview_file called: file_id={}", file_id);
    
    // Récupère les métadonnées du fichier depuis l'index local
    let (logical_path, file_uuid_bytes) = {
        let index = open_index_with_state(&app, &state)?;
        let metadata = index.get(&file_id)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?
            .ok_or_else(|| format!("File not found in index: {}", file_id))?;
        
        // Convertit le file_id (UUID hex) en bytes pour le download Storj
        let file_uuid = hex::decode(&file_id)
            .map_err(|e| format!("Invalid UUID format: {}", e))?;
        
        if file_uuid.len() != 16 {
            return Err(format!("Invalid UUID length: expected 16 bytes, got {}", file_uuid.len()));
        }
        
        (metadata.logical_path, file_uuid)
    };
    
    // Télécharge le fichier chiffré depuis Storj
    let client = {
        let client_guard = state.storj_client.lock().await;
        client_guard.clone()
            .ok_or_else(|| "Storj client not configured. Call storj_configure first.".to_string())?
    };
    
    let uuid_hex = hex::encode(&file_uuid_bytes);
    let object_key = format!("{}", uuid_hex);
    
    let encrypted_data = client.download_file(&object_key)
        .await
        .map_err(|e| format!("Failed to download file from Storj: {}", e))?;
    
    log::info!("File downloaded from Storj for preview: size={}", encrypted_data.len());
    
    // Déchiffre le fichier
    let plaintext = storage_decrypt_file(state.clone(), encrypted_data, logical_path)
        .map_err(|e| format!("Failed to decrypt file for preview: {}", e))?;
    
    log::info!("File decrypted successfully for preview: size={}", plaintext.len());
    Ok(plaintext)
}

/// Liste tous les fichiers dans la corbeille
#[tauri::command]
fn list_trash(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<TrashEntry>, String> {
    log::info!("list_trash called");
    
    let index = open_index_with_state(&app, &state)?;
    let trash_items = index.list_trash()
        .map_err(|e| format!("Failed to list trash: {}", e))?;
    
    let entries: Vec<TrashEntry> = trash_items.into_iter().map(|(id, meta, deleted_at)| {
        TrashEntry {
            id,
            logical_path: meta.logical_path,
            encrypted_size: meta.encrypted_size,
            deleted_at,
        }
    }).collect();
    
    log::info!("Found {} items in trash", entries.len());
    Ok(entries)
}

/// Restaure un fichier depuis la corbeille vers l'index principal
#[tauri::command]
fn restore_from_trash(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    file_id: String,
) -> Result<String, String> {
    log::info!("restore_from_trash called: file_id={}", file_id);
    
    let mut index = open_index_with_state(&app, &state)?;
    let metadata = index.restore_from_trash(&file_id)
        .map_err(|e| format!("Failed to restore file from trash: {}", e))?;
    
    log::info!("File restored from trash: file_id={}, logical_path={}", file_id, metadata.logical_path);
    Ok(metadata.logical_path)
}

/// Supprime définitivement un fichier de la corbeille (supprime aussi de Storj)
#[tauri::command]
async fn permanently_delete_from_trash(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    file_id: String,
) -> Result<(), String> {
    log::info!("permanently_delete_from_trash called: file_id={}", file_id);
    
    // Convertit le file_id en UUID bytes
    let file_uuid = hex::decode(&file_id)
        .map_err(|e| format!("Invalid UUID format: {}", e))?;
    
    if file_uuid.len() != 16 {
        return Err(format!("Invalid UUID length: expected 16 bytes, got {}", file_uuid.len()));
    }
    
    let uuid_array: [u8; 16] = file_uuid.try_into()
        .map_err(|_| "Failed to convert UUID to array".to_string())?;
    
    // Supprime de Storj
    let client = {
        let client_guard = state.storj_client.lock().await;
        client_guard.clone()
            .ok_or_else(|| "Storj client not configured. Call storj_configure first.".to_string())?
    };
    
    let uuid_hex = hex::encode(&uuid_array);
    let object_key = format!("{}", uuid_hex);
    
    client.delete_file(&object_key)
        .await
        .map_err(|e| format!("Failed to delete file from Storj: {}", e))?;
    
    log::info!("File deleted from Storj: object_key={}", object_key);
    
    // Supprime de la corbeille
    let mut index = open_index_with_state(&app, &state)?;
    index.remove_from_trash(&file_id)
        .map_err(|e| format!("Failed to remove file from trash: {}", e))?;
    
    log::info!("File permanently deleted from trash: file_id={}", file_id);
    Ok(())
}

/// Vide complètement la corbeille (supprime définitivement tous les fichiers de Storj et de la corbeille)
#[tauri::command]
async fn empty_trash(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    log::info!("empty_trash called");
    
    // Liste tous les fichiers dans la corbeille
    let index = open_index_with_state(&app, &state)?;
    let trash_items = index.list_trash()
        .map_err(|e| format!("Failed to list trash: {}", e))?;
    
    let count = trash_items.len();
    log::info!("Found {} items in trash to delete permanently", count);
    
    // Supprime tous les fichiers de Storj
    let client = {
        let client_guard = state.storj_client.lock().await;
        client_guard.clone()
            .ok_or_else(|| "Storj client not configured. Call storj_configure first.".to_string())?
    };
    
    for (file_id, _, _) in &trash_items {
        let file_uuid = hex::decode(file_id)
            .map_err(|e| format!("Invalid UUID format: {}", e))?;
        
        if file_uuid.len() == 16 {
            let uuid_array: [u8; 16] = file_uuid.try_into()
                .map_err(|_| "Failed to convert UUID to array".to_string())?;
            let uuid_hex = hex::encode(&uuid_array);
            let object_key = format!("{}", uuid_hex);
            
            // Supprime de Storj (ignore les erreurs pour continuer avec les autres fichiers)
            if let Err(e) = client.delete_file(&object_key).await {
                log::warn!("Failed to delete file {} from Storj: {}", file_id, e);
            }
        }
    }
    
    // Vide la corbeille
    let mut index = open_index_with_state(&app, &state)?;
    let deleted_count = index.empty_trash()
        .map_err(|e| format!("Failed to empty trash: {}", e))?;
    
    log::info!("Trash emptied: {} items permanently deleted", deleted_count);
    Ok(deleted_count)
}

#[derive(Debug, Serialize)]
pub struct TrashEntry {
    pub id: String,
    pub logical_path: String,
    pub encrypted_size: u64,
    pub deleted_at: i64, // Timestamp Unix en secondes
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .manage(AppState {
            master_key: Mutex::new(None),
            storj_client: AsyncMutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            crypto_bootstrap,
            crypto_unlock,
            crypto_change_password,
            get_index_db_path,
            reset_local_database,
            get_index_status,
            index_add_file,
            index_list_files,
            list_files_and_folders,
            create_folder,
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
            storj_delete_file,
            rename_file,
            list_trash,
            restore_from_trash,
            permanently_delete_from_trash,
            empty_trash,
            preview_file,
            select_and_read_file,
            select_and_read_file_from_path,
            save_decrypted_file
        ])
        .setup(|_app| {
            // Les plugins sont initialisés via .plugin() dans le Builder
            // Note: Le drag & drop HTML5 ne fonctionne pas dans Tauri car Tauri intercepte les événements natifs
            // Pour l'instant, on utilise uniquement le sélecteur de fichier
            // Le drag & drop sera implémenté dans une future version quand l'API Tauri sera disponible
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
