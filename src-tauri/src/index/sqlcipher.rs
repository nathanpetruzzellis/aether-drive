use hkdf::Hkdf;
use log;
use rusqlite::{params, Connection, Result as SqliteResult};
use sha2::Sha256;
use std::path::{Path, PathBuf};

use super::{FileId, FileMetadata};

const DB_KEY_INFO: &[u8] = b"aether-drive:sqlcipher-key:v1";
const SCHEMA_VERSION: u32 = 1;
const DB_KEY_LEN: usize = 32;

/// Index local persistant basé sur SQLCipher (AES-256).
///
/// La clé de chiffrement de la base est dérivée de la MasterKey via HKDF-SHA256,
/// garantissant que seul le détenteur de la MasterKey peut accéder à l'index.
pub struct SqlCipherIndex {
    conn: Connection,
}

impl SqlCipherIndex {
    /// Ouvre ou crée une base SQLCipher chiffrée à partir d'une MasterKey.
    ///
    /// # Arguments
    /// * `db_path` - Chemin du fichier SQLite à créer/ouvrir.
    /// * `master_key` - MasterKey utilisée pour dériver la clé de chiffrement SQLCipher (doit faire exactement 32 octets).
    pub fn open<P: AsRef<Path>>(db_path: P, master_key: &[u8]) -> SqliteResult<Self> {
        if master_key.len() != DB_KEY_LEN {
            log::error!("SqlCipherIndex::open: MasterKey length is {} instead of {}", master_key.len(), DB_KEY_LEN);
            return Err(rusqlite::Error::InvalidQuery);
        }
        let master_key_array: [u8; DB_KEY_LEN] = master_key.try_into().unwrap();
        // Dérive la clé SQLCipher (32 octets) depuis la MasterKey via HKDF-SHA256.
        let hkdf = Hkdf::<Sha256>::new(None, &master_key_array);
        let mut db_key = [0u8; DB_KEY_LEN];
        hkdf.expand(DB_KEY_INFO, &mut db_key)
            .map_err(|_| {
                log::error!("SqlCipherIndex::open: HKDF expansion failed");
                rusqlite::Error::InvalidQuery
            })?;

        let db_path_buf: PathBuf = db_path.as_ref().to_path_buf();
        let key_hex = hex::encode(db_key);
        log::info!("SqlCipherIndex::open: Opening database at {}", db_path_buf.to_string_lossy());

        // Si le fichier existe, essaie de l'ouvrir avec la clé dérivée.
        if db_path_buf.exists() {
            log::info!("SqlCipherIndex::open: Database file exists, attempting to open");
            match Connection::open(&db_path_buf) {
                        Ok(test_conn) => {
                    // Essaie de configurer la clé SQLCipher.
                    match test_conn.pragma_update(None, "key", &format!("x'{}'", key_hex)) {
                        Ok(_) => {
                            // Essaie d'accéder à la table pour vérifier que la base est valide.
                            // Utilise "SELECT 1" d'abord, puis essaie d'accéder à la table si elle existe.
                            match test_conn.query_row("SELECT 1", [], |_| Ok(())) {
                                Ok(_) => {
                                    // La base répond, vérifie maintenant si la table existe.
                                    // Si la table n'existe pas, c'est OK (première ouverture).
                                    // Si elle existe mais qu'on ne peut pas y accéder, la clé est incorrecte.
                                    let table_exists = test_conn.query_row(
                                        "SELECT name FROM sqlite_master WHERE type='table' AND name='file_index'",
                                        [],
                                        |row| Ok(row.get::<_, String>(0)?)
                                    ).is_ok();
                                    
                                    if table_exists {
                                        // La table existe, teste l'accès réel.
                                        match test_conn.query_row("SELECT COUNT(*) FROM file_index", [], |_| Ok(())) {
                                            Ok(_) => {
                                                // La base est valide, on peut l'utiliser.
                                                log::info!("SqlCipherIndex::open: Existing database opened successfully");
                                                drop(test_conn);
                                                return Self::open_existing(db_path_buf, key_hex);
                                            }
                                            Err(e) => {
                                                // La clé ne correspond pas ou la base est corrompue.
                                                log::warn!("SqlCipherIndex::open: Database key mismatch (table exists but inaccessible): {}, removing file", e);
                                                drop(test_conn);
                                                std::fs::remove_file(&db_path_buf).ok();
                                            }
                                        }
                                    } else {
                                        // La table n'existe pas encore, mais la base est valide.
                                        // On peut l'utiliser, le schéma sera créé plus tard.
                                        log::info!("SqlCipherIndex::open: Existing database opened successfully (table will be created)");
                                        drop(test_conn);
                                        return Self::open_existing(db_path_buf, key_hex);
                                    }
                                }
                                Err(e) => {
                                    // La clé ne correspond pas ou la base est corrompue.
                                    log::warn!("SqlCipherIndex::open: Database key mismatch or corruption: {}, removing file", e);
                                    drop(test_conn);
                                    std::fs::remove_file(&db_path_buf).ok();
                                }
                            }
                        }
                        Err(e) => {
                            // Impossible de configurer la clé.
                            log::warn!("SqlCipherIndex::open: Failed to set SQLCipher key: {}, removing file", e);
                            drop(test_conn);
                            std::fs::remove_file(&db_path_buf).ok();
                        }
                    }
                }
                Err(e) => {
                    // Impossible d'ouvrir le fichier, on le supprime.
                    log::warn!("SqlCipherIndex::open: Failed to open database file: {}, removing", e);
                    std::fs::remove_file(&db_path_buf).ok();
                }
            }
        } else {
            log::info!("SqlCipherIndex::open: Database file does not exist, will create new one");
        }

        // Crée une nouvelle base SQLCipher.
        let conn = Connection::open(&db_path_buf)?;
        conn.pragma_update(None, "key", &format!("x'{}'", key_hex))?;

        // Crée le schéma si nécessaire.
        conn.execute(
            "CREATE TABLE IF NOT EXISTS file_index (
                id TEXT PRIMARY KEY,
                logical_path TEXT NOT NULL,
                encrypted_size INTEGER NOT NULL
            )",
            [],
        )?;

        // Enregistre la version du schéma.
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;

        Ok(Self { conn })
    }

    /// Ouvre une base SQLCipher existante déjà valide.
    fn open_existing<P: AsRef<Path>>(db_path: P, key_hex: String) -> SqliteResult<Self> {
        let conn = Connection::open(db_path)?;
        conn.pragma_update(None, "key", &format!("x'{}'", key_hex))?;
        // Vérifie que la base est valide en exécutant une requête simple.
        conn.query_row("SELECT 1", [], |_| Ok(()))?;
        
        // Crée le schéma si nécessaire (au cas où la table n'existerait pas encore).
        conn.execute(
            "CREATE TABLE IF NOT EXISTS file_index (
                id TEXT PRIMARY KEY,
                logical_path TEXT NOT NULL,
                encrypted_size INTEGER NOT NULL
            )",
            [],
        )?;
        
        // Enregistre la version du schéma.
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        
        Ok(Self { conn })
    }

    pub fn upsert(&mut self, id: FileId, meta: FileMetadata) -> SqliteResult<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO file_index (id, logical_path, encrypted_size) VALUES (?1, ?2, ?3)",
            params![id, meta.logical_path, meta.encrypted_size as i64],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &FileId) -> SqliteResult<Option<FileMetadata>> {
        let mut stmt = self
            .conn
            .prepare("SELECT logical_path, encrypted_size FROM file_index WHERE id = ?1")?;
        let mut rows = stmt.query_map([id], |row| {
            Ok(FileMetadata {
                logical_path: row.get(0)?,
                encrypted_size: row.get::<_, i64>(1)? as u64,
            })
        })?;

        match rows.next() {
            Some(Ok(meta)) => Ok(Some(meta)),
            Some(Err(e)) => Err(e),
            None => Ok(None),
        }
    }

    pub fn remove(&mut self, id: &FileId) -> SqliteResult<()> {
        self.conn
            .execute("DELETE FROM file_index WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn len(&self) -> SqliteResult<usize> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM file_index", [], |row| row.get(0))?;
        Ok(count as usize)
    }

    pub fn is_empty(&self) -> SqliteResult<bool> {
        Ok(self.len()? == 0)
    }

    /// Liste tous les fichiers de l'index.
    pub fn list_all(&self) -> SqliteResult<Vec<(FileId, FileMetadata)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, logical_path, encrypted_size FROM file_index ORDER BY logical_path",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                FileMetadata {
                    logical_path: row.get(1)?,
                    encrypted_size: row.get::<_, i64>(2)? as u64,
                },
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn sqlcipher_index_roundtrip() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let master_key: [u8; 32] = [42u8; 32];

        // Crée l'index et insère une entrée.
        let mut index = SqlCipherIndex::open(&db_path, &master_key).unwrap();
        let meta = FileMetadata {
            logical_path: "/test/file.txt".to_string(),
            encrypted_size: 1024,
        };
        index.upsert("file-1".to_string(), meta.clone()).unwrap();

        // Vérifie que l'entrée est présente.
        let retrieved = index.get(&"file-1".to_string()).unwrap();
        assert!(retrieved.is_some());
        let retrieved_meta = retrieved.unwrap();
        assert_eq!(retrieved_meta.logical_path, meta.logical_path);
        assert_eq!(retrieved_meta.encrypted_size, meta.encrypted_size);

        // Vérifie que l'index n'est pas vide.
        assert_eq!(index.len().unwrap(), 1);
        assert!(!index.is_empty().unwrap());

        // Supprime l'entrée.
        index.remove(&"file-1".to_string()).unwrap();
        assert!(index.get(&"file-1".to_string()).unwrap().is_none());
        assert_eq!(index.len().unwrap(), 0);
        assert!(index.is_empty().unwrap());
    }

    #[test]
    fn sqlcipher_index_persists_across_sessions() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("persist.db");
        let master_key: [u8; 32] = [99u8; 32];

        // Première session : crée et insère.
        {
            let mut index = SqlCipherIndex::open(&db_path, &master_key).unwrap();
            index
                .upsert(
                    "persist-1".to_string(),
                    FileMetadata {
                        logical_path: "/persist/test.txt".to_string(),
                        encrypted_size: 2048,
                    },
                )
                .unwrap();
        }

        // Deuxième session : rouvre et vérifie.
        {
            let index = SqlCipherIndex::open(&db_path, &master_key).unwrap();
            let retrieved = index.get(&"persist-1".to_string()).unwrap();
            assert!(retrieved.is_some());
            assert_eq!(retrieved.unwrap().logical_path, "/persist/test.txt");
        }
    }
}
