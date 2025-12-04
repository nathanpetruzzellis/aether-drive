use sha2::{Sha256, Digest};
use std::collections::HashMap;

use super::{FileId, FileMetadata};

/// Représente un nœud dans l'arbre de Merkle.
#[derive(Debug, Clone)]
pub struct MerkleNode {
    hash: [u8; 32],
}

impl MerkleNode {
    pub fn hash(&self) -> &[u8; 32] {
        &self.hash
    }
}

/// Construit un arbre de Merkle depuis toutes les entrées de l'index.
///
/// L'arbre de Merkle permet de vérifier l'intégrité globale de l'index :
/// - Chaque feuille est le hash d'une entrée (id + logical_path + encrypted_size)
/// - Les nœuds internes sont le hash de leurs enfants
/// - La racine représente l'intégrité de tout l'index
pub struct MerkleTree {
    root: MerkleNode,
    entries: HashMap<FileId, FileMetadata>,
}

impl MerkleTree {
    /// Construit un arbre de Merkle depuis toutes les entrées de l'index.
    pub fn build(entries: &HashMap<FileId, FileMetadata>) -> Self {
        if entries.is_empty() {
            // Arbre vide : racine = hash d'une chaîne vide.
            let mut hasher = Sha256::new();
            hasher.update(b"aether-drive:merkle:empty");
            let root_hash: [u8; 32] = hasher.finalize().into();
            return Self {
                root: MerkleNode { hash: root_hash },
                entries: HashMap::new(),
            };
        }

        // Calcule les hashs des feuilles (une par entrée).
        let mut leaf_hashes: Vec<[u8; 32]> = entries
            .iter()
            .map(|(id, meta)| Self::hash_entry(id, meta))
            .collect();
        
        // Trie les hashs pour garantir un ordre déterministe.
        leaf_hashes.sort();

        // Construit l'arbre de bas en haut.
        let root = Self::build_tree(&leaf_hashes);

        Self {
            root,
            entries: entries.clone(),
        }
    }

    /// Calcule le hash d'une entrée de l'index.
    fn hash_entry(id: &FileId, meta: &FileMetadata) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(b"aether-drive:merkle:entry:");
        hasher.update(id.as_bytes());
        hasher.update(b":");
        hasher.update(meta.logical_path.as_bytes());
        hasher.update(b":");
        hasher.update(&meta.encrypted_size.to_le_bytes());
        hasher.finalize().into()
    }

    /// Construit l'arbre de Merkle récursivement.
    fn build_tree(hashes: &[[u8; 32]]) -> MerkleNode {
        if hashes.len() == 1 {
            return MerkleNode { hash: hashes[0] };
        }

        // Divise en deux groupes et construit récursivement.
        let mid = hashes.len() / 2;
        let left = Self::build_tree(&hashes[..mid]);
        let right = Self::build_tree(&hashes[mid..]);

        // Hash des deux enfants.
        let mut hasher = Sha256::new();
        hasher.update(b"aether-drive:merkle:node:");
        hasher.update(left.hash());
        hasher.update(right.hash());
        let node_hash: [u8; 32] = hasher.finalize().into();

        MerkleNode { hash: node_hash }
    }

    /// Retourne le hash de la racine de l'arbre.
    pub fn root_hash(&self) -> &[u8; 32] {
        self.root.hash()
    }

    /// Vérifie l'intégrité de l'index en comparant avec un hash de racine attendu.
    pub fn verify(&self, expected_root_hash: &[u8; 32]) -> bool {
        self.root.hash() == expected_root_hash
    }

    /// Retourne une copie des entrées utilisées pour construire l'arbre.
    pub fn entries(&self) -> &HashMap<FileId, FileMetadata> {
        &self.entries
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merkle_tree_empty() {
        let entries = HashMap::new();
        let tree = MerkleTree::build(&entries);
        let root = tree.root_hash();
        assert_eq!(root.len(), 32);
    }

    #[test]
    fn test_merkle_tree_single_entry() {
        let mut entries = HashMap::new();
        entries.insert(
            "file-1".to_string(),
            FileMetadata {
                logical_path: "/test/file.txt".to_string(),
                encrypted_size: 1024,
            },
        );

        let tree = MerkleTree::build(&entries);
        let root = tree.root_hash();
        assert_eq!(root.len(), 32);
    }

    #[test]
    fn test_merkle_tree_multiple_entries() {
        let mut entries = HashMap::new();
        entries.insert(
            "file-1".to_string(),
            FileMetadata {
                logical_path: "/test/file1.txt".to_string(),
                encrypted_size: 1024,
            },
        );
        entries.insert(
            "file-2".to_string(),
            FileMetadata {
                logical_path: "/test/file2.txt".to_string(),
                encrypted_size: 2048,
            },
        );
        entries.insert(
            "file-3".to_string(),
            FileMetadata {
                logical_path: "/test/file3.txt".to_string(),
                encrypted_size: 4096,
            },
        );

        let tree = MerkleTree::build(&entries);
        let root = tree.root_hash();
        assert_eq!(root.len(), 32);
        
        // Vérifie que l'arbre est déterministe.
        let tree2 = MerkleTree::build(&entries);
        assert_eq!(tree.root_hash(), tree2.root_hash());
    }

    #[test]
    fn test_merkle_tree_verify() {
        let mut entries = HashMap::new();
        entries.insert(
            "file-1".to_string(),
            FileMetadata {
                logical_path: "/test/file.txt".to_string(),
                encrypted_size: 1024,
            },
        );

        let tree = MerkleTree::build(&entries);
        let root_hash = *tree.root_hash();
        
        // Vérifie avec le bon hash.
        assert!(tree.verify(&root_hash));
        
        // Vérifie avec un mauvais hash.
        let mut wrong_hash = root_hash;
        wrong_hash[0] ^= 1;
        assert!(!tree.verify(&wrong_hash));
    }

    #[test]
    fn test_merkle_tree_detects_changes() {
        let mut entries1 = HashMap::new();
        entries1.insert(
            "file-1".to_string(),
            FileMetadata {
                logical_path: "/test/file.txt".to_string(),
                encrypted_size: 1024,
            },
        );

        let mut entries2 = HashMap::new();
        entries2.insert(
            "file-1".to_string(),
            FileMetadata {
                logical_path: "/test/file.txt".to_string(),
                encrypted_size: 2048, // Taille différente
            },
        );

        let tree1 = MerkleTree::build(&entries1);
        let tree2 = MerkleTree::build(&entries2);

        // Les racines doivent être différentes.
        assert_ne!(tree1.root_hash(), tree2.root_hash());
    }
}

