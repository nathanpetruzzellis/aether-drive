use std::collections::HashMap;

pub mod sqlcipher;
pub mod merkle;

/// Identifiant logique d'un fichier dans l'index local.
pub type FileId = String;

/// Métadonnées minimales d'un fichier chiffré.
#[derive(Debug, Clone)]
pub struct FileMetadata {
    /// Chemin logique présenté à l'utilisateur (inclus dans l'AAD côté crypto).
    pub logical_path: String,
    /// Taille du contenu chiffré, en octets.
    pub encrypted_size: u64,
}

/// API de base pour l'index local.
///
/// NOTE : cette première version est purement en mémoire.
/// La persistance réelle se fera via SQLite + SQLCipher,
/// conformément à la blueprint, dans une micro-étape suivante.
#[derive(Default)]
pub struct InMemoryIndex {
    entries: HashMap<FileId, FileMetadata>,
}

impl InMemoryIndex {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    pub fn upsert(&mut self, id: FileId, meta: FileMetadata) {
        self.entries.insert(id, meta);
    }

    pub fn get(&self, id: &FileId) -> Option<&FileMetadata> {
        self.entries.get(id)
    }

    pub fn remove(&mut self, id: &FileId) {
        self.entries.remove(id);
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}
