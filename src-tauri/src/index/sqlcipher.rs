use hkdf::Hkdf;
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
    pub fn open<P: AsRef<Path>>(
        db_path: P,
        master_key: &[u8],
    ) -> SqliteResult<Self> {
        if master_key.len() != DB_KEY_LEN {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let master_key_array: [u8; DB_KEY_LEN] = master_key.try_into().unwrap();
        // Dérive la clé SQLCipher (32 octets) depuis la MasterKey via HKDF-SHA256.
        let hkdf = Hkdf::<Sha256>::new(None, &master_key_array);
        let mut db_key = [0u8; DB_KEY_LEN];
        hkdf.expand(DB_KEY_INFO, &mut db_key)
            .map_err(|_| rusqlite::Error::InvalidQuery)?;

        let db_path_buf: PathBuf = db_path.as_ref().to_path_buf();
        let key_hex = hex::encode(db_key);
        
        // Si le fichier existe mais n'est pas valide, on le supprime.
        if db_path_buf.exists() {
            if let Ok(test_conn) = Connection::open(&db_path_buf) {
                // Essaie de configurer la clé SQLCipher.
                if test_conn.pragma_update(None, "key", &format!("x'{}'", key_hex)).is_ok() {
                    // Essaie une requête pour vérifier que la base est valide.
                    if test_conn.query_row("SELECT 1", [], |_| Ok(())).is_ok() {
                        // La base est valide, on peut l'utiliser.
                        drop(test_conn);
                        return Self::open_existing(db_path_buf, key_hex);
                    }
                }
                // Si on arrive ici, la base n'est pas valide.
                drop(test_conn);
            }
            // Supprime le fichier corrompu.
            std::fs::remove_file(&db_path_buf).ok();
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
    fn open_existing<P: AsRef<Path>>(
        db_path: P,
        key_hex: String,
    ) -> SqliteResult<Self> {
        let conn = Connection::open(db_path)?;
        conn.pragma_update(None, "key", &format!("x'{}'", key_hex))?;
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
        let mut stmt = self.conn.prepare(
            "SELECT logical_path, encrypted_size FROM file_index WHERE id = ?1"
        )?;
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
        self.conn.execute("DELETE FROM file_index WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn len(&self) -> SqliteResult<usize> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM file_index",
            [],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    pub fn is_empty(&self) -> SqliteResult<bool> {
        Ok(self.len()? == 0)
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

